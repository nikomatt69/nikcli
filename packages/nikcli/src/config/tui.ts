import { existsSync } from "fs"
import { readdir } from "fs/promises"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Config } from "./config"
import { ConfigPaths } from "./paths"
import { migrateTuiConfig } from "./migrate-tui-config"
import { TuiInfo } from "./tui-schema"
import { Instance } from "@/project/instance"
import { Flag } from "@nikcli-ai/util/flag"
import { Log } from "@nikcli-ai/util/log"
import { isRecord } from "@nikcli-ai/util/record"
import { Global } from "@nikcli-ai/util/global"
import { parsePluginSpecifier } from "@nikcli-ai/util/plugin-shared"
import { Effect } from "effect"
import { InstanceState, runPromiseWithLayer, type InstanceContext } from "@/effect"
import { Filesystem } from "@nikcli-ai/util/filesystem"

export namespace TuiConfig {
  const log = Log.create({ service: "tui.config" })

  export const Info = TuiInfo

  export type PluginMeta = {
    scope: "global" | "local"
    source: string
  }

  type PluginEntry = {
    item: Config.PluginSpec
    meta: PluginMeta
  }

  type Acc = {
    result: Info
    entries: PluginEntry[]
  }

  export type Info = z.output<typeof Info> & {
    plugin_meta?: Record<string, PluginMeta>
  }

  function pluginScope(ctx: InstanceContext, file: string): PluginMeta["scope"] {
    if (Filesystem.containsCanonical(ctx.directory, file)) return "local"
    if (ctx.worktree !== "/" && Filesystem.containsCanonical(ctx.worktree, file)) return "local"
    return "global"
  }

  function dedupePlugins(list: PluginEntry[]) {
    const seen = new Set<string>()
    const result: PluginEntry[] = []
    for (const item of list.toReversed()) {
      const spec = Config.pluginSpecifier(item.item)
      const name = spec.startsWith("file://") ? spec : parsePluginSpecifier(spec).pkg
      if (seen.has(name)) continue
      seen.add(name)
      result.push(item)
    }
    return result.toReversed()
  }

  function mergeInfo(target: Info, source: Info): Info {
    const merged = mergeDeep(target, source)
    return merged
  }

  function customPath() {
    return Flag.NIKCLI_TUI_CONFIG
  }

  const PLUGIN_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"])

  /**
   * Directories scanned for TUI plugin files, per config root.
   *
   * `plugin/` and `plugins/` themselves belong to the *server* plugin loader
   * (`Config.loadPlugin` globs `{plugin,plugins}/*.{ts,js}`, non-recursively),
   * so TUI plugins live one level deeper and the two never collide.
   */
  export function pluginDirectories(root: string) {
    return [path.join(root, "plugin", "tui"), path.join(root, "plugins", "tui")]
  }

  /** TUI plugin files found under one config root, as `file://` specs. */
  export async function discoverPlugins(root: string) {
    const found: string[] = []
    for (const directory of pluginDirectories(root)) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        if (!PLUGIN_EXTENSIONS.has(path.extname(entry.name))) continue
        found.push(pathToFileURL(path.join(directory, entry.name)).href)
      }
    }
    return found.sort()
  }

  function normalize(raw: Record<string, unknown>) {
    const data = { ...raw }
    if (!("tui" in data)) return data
    if (!isRecord(data.tui)) {
      delete data.tui
      return data
    }

    const tui = data.tui
    delete data.tui
    return {
      ...tui,
      ...data,
    }
  }

  function installDeps(dir: string): Promise<void> {
    return Config.installDependencies(dir)
  }

  const mergeFile = Effect.fn("TuiConfig.mergeFile")(function* (
    ctx: InstanceContext,
    paths: ConfigPaths.Interface,
    acc: Acc,
    file: string,
  ) {
    const data = yield* loadFile(paths, file)
    acc.result = mergeInfo(acc.result, data)
    if (!data.plugin?.length) return

    const scope = pluginScope(ctx, file)
    for (const item of data.plugin) {
      acc.entries.push({
        item,
        meta: {
          scope,
          source: file,
        },
      })
    }
  })

  /**
   * @param options.bootstrap  First-load work: legacy config migration and
   * plugin dependency installation. Reloads set it to `false` — the migration
   * has already run and dependency installation is a `bun add` per config dir.
   */
  const loadState = Effect.fn("TuiConfig.loadState")(function* (options?: { bootstrap?: boolean }) {
    const bootstrap = options?.bootstrap !== false
    const ctx = yield* InstanceState.context
    const paths = yield* ConfigPaths.Service
    let projectFiles = Flag.NIKCLI_DISABLE_PROJECT_CONFIG
      ? []
      : yield* paths.projectFiles("tui", ctx.directory, ctx.worktree)
    const directories = yield* paths.directories(ctx.directory, ctx.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()
    if (bootstrap) {
      yield* Effect.promise(() => migrateTuiConfig({ instance: ctx, directories, custom, managed }))
      // Re-compute after migration since migrateTuiConfig may have created new tui.json files
      projectFiles = Flag.NIKCLI_DISABLE_PROJECT_CONFIG
        ? []
        : yield* paths.projectFiles("tui", ctx.directory, ctx.worktree)
    }

    const acc: Acc = {
      result: {},
      entries: [],
    }

    // Every file consulted for this snapshot, existing or not: the TUI watches
    // these paths so a `tui.json` created later is still picked up.
    const files: string[] = []
    const merge = (file: string) => {
      files.push(file)
      return mergeFile(ctx, paths, acc, file)
    }

    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      yield* merge(file)
    }

    if (custom) {
      yield* merge(custom)
      log.debug("loaded custom tui config", { path: custom })
    }

    for (const file of projectFiles) {
      yield* merge(file)
    }

    for (const dir of unique(directories)) {
      if (!dir.endsWith(".nikcli") && dir !== Flag.NIKCLI_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        yield* merge(file)
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        yield* merge(file)
      }
    }

    // Directory-discovered plugins come first so a config entry for the same
    // file wins deduplication (and keeps its options), mirroring load order:
    // discovered plugins load before configured ones.
    const roots = unique([
      Global.Path.config,
      ...directories.filter((dir) => dir.endsWith(".nikcli") || dir === Flag.NIKCLI_CONFIG_DIR),
      ...(existsSync(managed) ? [managed] : []),
    ])
    const discovered: PluginEntry[] = []
    for (const root of roots) {
      for (const spec of yield* Effect.promise(() => discoverPlugins(root))) {
        discovered.push({
          item: spec,
          meta: {
            scope: pluginScope(ctx, spec.startsWith("file://") ? fileURLToPath(spec) : spec),
            source: root,
          },
        })
      }
    }

    const merged = dedupePlugins([...discovered, ...acc.entries])
    acc.result.keybinds = Config.Keybinds.parse(acc.result.keybinds ?? {})
    acc.result.plugin = merged.map((item) => item.item)
    // Assign the key only when there is something to put in it. The HttpApi
    // response schema declares `plugin_meta` as `optionalKey`, which rejects a
    // present `undefined` at encode time — so writing `undefined` here turned
    // `GET /tui/config` into an empty 400 for every user with no plugins, and
    // the TUI read that as an empty config (no keybinds) with nothing logged.
    if (merged.length) {
      acc.result.plugin_meta = Object.fromEntries(merged.map((item) => [Config.pluginSpecifier(item.item), item.meta]))
    } else {
      delete acc.result.plugin_meta
    }

    const deps: Promise<void>[] = []
    if (bootstrap && acc.result.plugin?.length) {
      for (const dir of unique(directories)) {
        if (!dir.endsWith(".nikcli") && dir !== Flag.NIKCLI_CONFIG_DIR) continue
        deps.push(installDeps(dir))
      }
    }

    return {
      config: acc.result,
      deps,
      sources: {
        files: unique(files),
        directories: roots.flatMap(pluginDirectories),
      },
    }
  })

  const state = Instance.state(async () => {
    return runPromiseWithLayer(ConfigPaths.defaultLayer, loadState())
  })

  type Snapshot = Awaited<ReturnType<typeof state>>

  // `Instance.state` memoizes for the life of the instance and has no per-entry
  // invalidation, so a reload parks the fresh snapshot here and every read goes
  // through it. Also `Instance.state`, so the override is keyed and disposed by
  // the same mechanism as the snapshot it shadows rather than by a module-level
  // map that has to be told which instance is asking.
  const reloaded = Instance.state(() => ({ value: undefined as Promise<Snapshot> | undefined }))

  function current(): Promise<Snapshot> {
    return reloaded().value ?? state()
  }

  export async function get() {
    return current().then((x) => x.config)
  }

  /**
   * Re-reads the TUI config files from disk and replaces the cached snapshot.
   *
   * Consumers that already read `get()` keep their values until they read
   * again; the plugin runtime is the caller that acts on the new plugin list.
   */
  export async function reload() {
    const slot = reloaded()
    const next = runPromiseWithLayer(ConfigPaths.defaultLayer, loadState({ bootstrap: false }))
    slot.value = next.catch((error) => {
      log.warn("failed to reload tui config", { error })
      // Keep serving the previous snapshot rather than a rejected promise.
      slot.value = undefined
      return current()
    })
    return current().then((x) => x.config)
  }

  /** Config files and plugin directories this snapshot was built from. */
  export async function sources() {
    return current().then((x) => x.sources)
  }

  export async function waitForDependencies() {
    const deps = await current().then((x) => x.deps)
    await Promise.all(deps)
  }

  const loadFile = Effect.fn("TuiConfig.loadFile")(function* (paths: ConfigPaths.Interface, filepath: string) {
    const text = yield* paths.readFile(filepath)
    if (!text) return {}
    return yield* load(paths, text, filepath).pipe(
      Effect.catch((error: unknown) =>
        Effect.sync(() => {
          log.warn("failed to load tui config", { path: filepath, error })
          return {}
        }),
      ),
    )
  })

  const load = Effect.fn("TuiConfig.load")(function* (
    paths: ConfigPaths.Interface,
    text: string,
    configFilepath: string,
  ) {
    const raw = yield* paths.parseText(text, configFilepath, "empty")
    if (!isRecord(raw)) return {}

    // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
    // (mirroring the old nikcli.json shape) still get their settings applied.
    const normalized = normalize(raw)

    const parsed = Info.safeParse(normalized)
    if (!parsed.success) {
      log.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
      return {}
    }

    const data = parsed.data
    const plugins = data.plugin
    if (plugins) {
      for (let i = 0; i < plugins.length; i++) {
        plugins[i] = yield* Effect.promise(() => Config.resolvePluginSpec(plugins[i], configFilepath))
      }
    }

    return data
  })
}
