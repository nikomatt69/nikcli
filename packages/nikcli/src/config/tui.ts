import { existsSync } from "fs"
import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Config } from "./config"
import { ConfigPaths } from "./paths"
import { migrateTuiConfig } from "./migrate-tui-config"
import { TuiInfo } from "./tui-schema"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { isRecord } from "@/util/record"
import { Global } from "@/global"
import { parsePluginSpecifier } from "@/plugin/shared"
import { Effect } from "effect"
import { InstanceState, type InstanceContext } from "@/effect"
import { Filesystem } from "@/util/filesystem"

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

  const loadState = Effect.fn("TuiConfig.loadState")(function* () {
    const ctx = yield* InstanceState.context
    const paths = yield* ConfigPaths.Service
    let projectFiles = Flag.NIKCLI_DISABLE_PROJECT_CONFIG
      ? []
      : yield* paths.projectFiles("tui", ctx.directory, ctx.worktree)
    const directories = yield* paths.directories(ctx.directory, ctx.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()
    yield* Effect.promise(() => migrateTuiConfig({ directories, custom, managed }))
    // Re-compute after migration since migrateTuiConfig may have created new tui.json files
    projectFiles = Flag.NIKCLI_DISABLE_PROJECT_CONFIG
      ? []
      : yield* paths.projectFiles("tui", ctx.directory, ctx.worktree)

    const acc: Acc = {
      result: {},
      entries: [],
    }

    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      yield* mergeFile(ctx, paths, acc, file)
    }

    if (custom) {
      yield* mergeFile(ctx, paths, acc, custom)
      log.debug("loaded custom tui config", { path: custom })
    }

    for (const file of projectFiles) {
      yield* mergeFile(ctx, paths, acc, file)
    }

    for (const dir of unique(directories)) {
      if (!dir.endsWith(".nikcli") && dir !== Flag.NIKCLI_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        yield* mergeFile(ctx, paths, acc, file)
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        yield* mergeFile(ctx, paths, acc, file)
      }
    }

    const merged = dedupePlugins(acc.entries)
    acc.result.keybinds = Config.Keybinds.parse(acc.result.keybinds ?? {})
    acc.result.plugin = merged.map((item) => item.item)
    acc.result.plugin_meta = merged.length
      ? Object.fromEntries(merged.map((item) => [Config.pluginSpecifier(item.item), item.meta]))
      : undefined

    const deps: Promise<void>[] = []
    if (acc.result.plugin?.length) {
      for (const dir of unique(directories)) {
        if (!dir.endsWith(".nikcli") && dir !== Flag.NIKCLI_CONFIG_DIR) continue
        deps.push(installDeps(dir))
      }
    }

    return {
      config: acc.result,
      deps,
    }
  })

  const state = Instance.state(async () => {
    return Effect.runPromise(loadState().pipe(Effect.provide(ConfigPaths.defaultLayer)))
  })

  export async function get() {
    return state().then((x) => x.config)
  }

  export async function waitForDependencies() {
    const deps = await state().then((x) => x.deps)
    await Promise.all(deps)
  }

  const loadFile = Effect.fn("TuiConfig.loadFile")(function* (paths: ConfigPaths.Interface, filepath: string) {
    const text = yield* paths.readFile(filepath)
    if (!text) return {}
    return yield* load(paths, text, filepath).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          log.warn("failed to load tui config", { path: filepath, error })
          return {}
        }),
      ),
    )
  })

  const load = Effect.fn("TuiConfig.load")(function* (paths: ConfigPaths.Interface, text: string, configFilepath: string) {
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
        plugins[i] = yield* Effect.tryPromise({
          try: () => Config.resolvePluginSpec(plugins[i], configFilepath),
          catch: (error) => error as Error,
        })
      }
    }

    return data
  })
}
