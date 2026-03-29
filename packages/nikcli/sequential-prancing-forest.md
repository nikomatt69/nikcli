# Plan: Integrate PRs #19347 (TUI plugins) + #19467 (Single target entrypoints)

## Context

PRs #19347 and #19467 from `anomalyco/opencode` introduce a complete TUI plugin system:
- An extensible runtime that loads internal + external TUI plugins from `tui.json`
- Internal sidebar panels (context, MCP, LSP, todo, files, footer) rewritten as plugins
- A plugin manager dialog (install, enable/disable plugins)
- `opencode plugin <pkg>` / `opencode plug <pkg>` CLI command
- PR #19467 enforces single-target modules (`server` or `tui`, never both)

Target: integrate every change into `packages/nikcli/` with all import paths mapped to `@nikcli-ai/*`.

---

## Import / Name Mapping

| opencode | nikcli |
|---|---|
| `@opencode-ai/plugin/tui` | `@nikcli-ai/plugin/tui` |
| `@opencode-ai/plugin` | `@nikcli-ai/plugin` |
| `@opencode-ai/sdk/v2` | `@nikcli-ai/sdk/v2` |
| `createOpencodeClient` | `createNikcliClient` |
| `OpencodeClient` | `NikcliClient` |
| `Flag.OPENCODE_TUI_CONFIG` | `Flag.NIKCLI_TUI_CONFIG` (add to flag.ts) |
| `Flag.OPENCODE_PURE` | `Flag.NIKCLI_PURE` (add to flag.ts) |
| `Flag.OPENCODE_PLUGIN_META_FILE` | `Flag.NIKCLI_PLUGIN_META_FILE` (add to flag.ts) |
| `Flag.OPENCODE_DISABLE_PROJECT_CONFIG` | `Flag.NIKCLI_DISABLE_PROJECT_CONFIG` ✓ |
| `Flag.OPENCODE_CONFIG_DIR` | `Flag.NIKCLI_CONFIG_DIR` ✓ |
| `"OpenCode"` text in UI | `"NikCLI"` |

---

## Phase 1 – New Infrastructure Files (no UI dependencies)

### 1.1 `src/util/network.ts` _(new)_
Export two functions:
```ts
export function online(): boolean   // reads navigator.onLine, defaults true
export function proxied(): boolean  // checks HTTP_PROXY env vars
```

### 1.2 `src/util/flock.ts` _(new)_
Used by `plugin/meta.ts` and `plugin/install.ts`. Implements advisory file locking:
```ts
export namespace Flock {
  export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T>
}
```
Fetch from opencode: `src/util/flock.ts`.

### 1.3 `src/bun/registry.ts` _(new)_
Fetch full file from `anomalyco/opencode`. Add `online()` guard at top of `info()`.
Key exports: `PackageRegistry.info`, `PackageRegistry.isOutdated`.

### 1.4 `src/plugin/shared.ts` _(new)_
Full content from opencode (already fetched). Contains:
- `readV1Plugin` (enforces single-target, from PR #19467)
- `readPluginId`, `resolvePluginId`, `pluginSource`, `parsePluginSpecifier`
- `resolvePluginTarget`, `resolvePluginEntrypoint`, `checkPluginCompatibility`
- `isDeprecatedPlugin`
Replace package name in any log strings where relevant.

### 1.5 `src/plugin/meta.ts` _(new)_
Full content from opencode (already fetched). `PluginMeta` namespace.
Replace `Flag.OPENCODE_PLUGIN_META_FILE` → `Flag.NIKCLI_PLUGIN_META_FILE`.

### 1.6 `src/plugin/install.ts` _(new)_
Full content from opencode (already fetched). Exports `installPlugin`, `readPluginManifest`, `patchPluginConfig`.

### 1.7 `src/config/tui-schema.ts` _(new)_
Fetch from `anomalyco/opencode`. Zod schema for `tui.json`.

### 1.8 `src/config/migrate-tui-config.ts` _(new)_
Fetch from `anomalyco/opencode`. Migrates old opencode.json `tui` block to `tui.json`.

### 1.9 `src/config/paths.ts` _(new)_
Fetch from `anomalyco/opencode`. Utilities: `ConfigPaths.projectFiles`, `ConfigPaths.directories`, `ConfigPaths.fileInDirectory`, `ConfigPaths.readFile`, `ConfigPaths.parseText`.

### 1.10 `src/config/tui.ts` _(new)_
Full content from opencode. `TuiConfig` namespace: `get()`, `waitForDependencies()`, `PluginMeta` type.
Replace `Flag.OPENCODE_TUI_CONFIG` → `Flag.NIKCLI_TUI_CONFIG`, `Flag.OPENCODE_CONFIG_DIR` → `Flag.NIKCLI_CONFIG_DIR`, `Flag.OPENCODE_DISABLE_PROJECT_CONFIG` → `Flag.NIKCLI_DISABLE_PROJECT_CONFIG`.

---

## Phase 2 – `packages/plugin` Package Updates

### 2.1 `packages/plugin/src/index.ts` _(modify)_
Update `PluginModule`:
```ts
export type PluginModule = {
  id?: string
  server: Plugin     // was optional, now required
  tui?: never        // new — prevents dual-target modules
}
```

### 2.2 `packages/plugin/src/tui.ts` _(new)_
Create full TUI plugin type definitions. Key types:
- `TuiPlugin`, `TuiPluginModule` (target-exclusive: has `tui`, `server?: never`)
- `TuiPluginApi` (full surface: command, route, ui, keybind, kv, state, theme, client, event, renderer, slots, plugins, lifecycle, app)
- `TuiPluginMeta`, `TuiPluginStatus`, `TuiPluginInstallResult`
- `TuiSlotMap` (app, home_logo, home_bottom, sidebar_title, sidebar_content, sidebar_footer)
- `TuiDialogPromptProps` — add `busy?: boolean`, `busyText?: string`
- `TuiThemeCurrent` type (used by theme context refactor)
Import from `@nikcli-ai/sdk/v2` instead of `@opencode-ai/sdk/v2`.

### 2.3 `packages/plugin/package.json` _(modify)_
Add `./tui` export:
```json
"./tui": "./src/tui.ts"
```

---

## Phase 3 – Modify Existing Source Files

### 3.1 `src/flag/flag.ts` _(modify)_
Add three new flags:
```ts
export const NIKCLI_TUI_CONFIG = process.env["NIKCLI_TUI_CONFIG"]
export const NIKCLI_PURE = truthy("NIKCLI_PURE")
export const NIKCLI_PLUGIN_META_FILE = process.env["NIKCLI_PLUGIN_META_FILE"]
```

### 3.2 `src/bun/index.ts` _(modify)_
Apply PR #19347 diff:
- Replace `import { proxied } from "@/util/proxied"` → `import { online, proxied } from "@/util/network"`
- Fix version-check ordering: `latest` branch checks `online()` before `PackageRegistry.isOutdated`
- Reorder: check `cachedVersion === version` before `version === "latest"` branch

### 3.3 `src/plugin/index.ts` _(modify)_
Apply PR #19467 diff:
- Remove `getDefaultPlugin` import, add `readV1Plugin`, `readPluginId`, `resolvePluginId`, `readPluginPackage` imports from `./shared`
- Add `target` and `source` fields to `Loaded` type
- In `loadPlugin`: capture `source = pluginSource(spec)`, pass `target` and `source` into `Loaded`
- In `applyPlugin`: replace `getDefaultPlugin` call with `readV1Plugin(mod, spec, "server", "detect")`; after detection call `resolvePluginId` before applying hooks

### 3.4 `src/cli/cmd/tui/context/route.tsx` _(modify)_
Add `PluginRoute` type and expand `Route` union:
```ts
export type PluginRoute = { type: "plugin"; id: string; data?: Record<string, unknown> }
export type Route = HomeRoute | SessionRoute | PluginRoute
```
Remove `console.log("navigate", route)` from `navigate()`.

### 3.5 `src/cli/cmd/tui/context/sdk.tsx` _(modify)_
Expose `workspaceID` getter on the returned context object (needed by plugin API):
```ts
get workspaceID() { return workspaceID }
```

### 3.6 `src/cli/cmd/tui/context/keybind.tsx` _(modify)_
Change `match` and `print` signatures from `keyof KeybindsConfig` to `string` so plugins can pass arbitrary keybind strings:
```ts
match(key: string, evt: ParsedKey) {
  const list = keybinds()[key] ?? Keybind.parse(key)
  ...
}
print(key: string) {
  const first = keybinds()[key]?.at(0) ?? Keybind.parse(key).at(0)
  ...
}
```

### 3.7 `src/cli/cmd/tui/context/exit.tsx` _(modify)_
Add `onBeforeExit?: () => Promise<void>` to init input; call it before renderer teardown.

### 3.8 `src/cli/cmd/tui/context/theme.tsx` _(modify)_
Add `isRecord` import and `TuiThemeCurrent` type import from `@nikcli-ai/plugin/tui`.
Remove the local `ThemeColors` type definition (now replaced by `TuiThemeCurrent`).
Export `addTheme(name: string, data: unknown): void` and `hasTheme(name: string): boolean` functions for use by the plugin theme installer.

### 3.9 `src/cli/cmd/tui/component/dialog-command.tsx` _(modify)_
- Change `keybind?: KeybindKey` → `keybind?: string` on `CommandOption`
- Remove `KeybindKey` import
- Add `getOwner` / `runWithOwner` to solid-js imports; use them in `register()` so plugin commands survive outside Solid owner context
- Add `Show` to solid-js imports

### 3.10 `src/cli/cmd/tui/component/dialog-status.tsx` _(modify)_
Handle tuple plugin specs (`[spec, options]` format) by extracting the string spec:
```ts
const value = typeof item === "string" ? item : item[0]
```

### 3.11 `src/cli/cmd/tui/component/dialog-workspace-list.tsx` _(modify)_
Extract `scoped()` helper function (creates `createNikcliClient` bound to a workspace) and reuse it in two places instead of inline object creation.

### 3.12 `src/cli/cmd/tui/ui/dialog-prompt.tsx` _(modify)_
Apply PR diff fully:
- Add `busy?: boolean` and `busyText?: string` to `DialogPromptProps`
- Import `Spinner` from `../component/spinner`
- Import `Show`, `createEffect` from solid-js
- When `busy=true`: block all keyboard input (except escape no-op), blur textarea, show `<Spinner>` and "processing..." hint
- `createEffect` re-focuses/blurs textarea reactively based on `busy`
- Mute text colors when busy

---

## Phase 4 – New TUI Components

### 4.1 `src/cli/cmd/tui/component/spinner.tsx` _(new)_
Minimal spinner component using `opentui-spinner/solid`. Shows animated spinner frames + optional text label. Respects `kv.get("animations_enabled", true)` fallback.

### 4.2 `src/cli/cmd/tui/component/error-component.tsx` _(new)_
Full-screen error display extracted from `app.tsx`. Used by `ErrorBoundary`. Handles Ctrl+C exit, clipboard copy of error.

### 4.3 `src/cli/cmd/tui/component/plugin-route-missing.tsx` _(new)_
Fallback screen shown for unknown plugin route IDs. Shows warning + "go home" button.

### 4.4 `src/cli/cmd/tui/component/startup-loading.tsx` _(new)_
Animated loading overlay that appears only if startup takes >threshold ms. Shows "Loading plugins..." or "Finishing startup..." spinner.

### 4.5 `src/cli/cmd/tui/context/plugin-keybinds.ts` _(new)_
`createPluginKeybind(base, defaults, overrides?)` utility. Returns a plugin-local keybind set (`all`, `get`, `match`, `print`).

---

## Phase 5 – TUI Plugin Infrastructure

### 5.1 `src/cli/cmd/tui/plugin/slots.tsx` _(new)_
Slot registry wrapper. Exports `setupSlots`, `Slot` (view component), `HostPluginApi`, `HostSlots`.
Replace `@opencode-ai/plugin/tui` → `@nikcli-ai/plugin/tui`.

### 5.2 `src/cli/cmd/tui/plugin/api.tsx` _(new)_
Full TUI plugin API factory (406 lines). `createTuiApi(input)` returns the full `TuiPluginApi` surface exposed to plugins.
Replace `createOpencodeClient` → `createNikcliClient`, `OpencodeClient` → `NikcliClient`, `@opencode-ai/*` → `@nikcli-ai/*`.

### 5.3 `src/cli/cmd/tui/plugin/runtime.ts` _(new)_
Main TUI plugin runtime (972 lines). Handles load/init/dispose of internal + external plugins.
Apply PR #19467 diff: replace `getDefaultPlugin` call with `readV1Plugin(raw, spec, "tui")`.
Replace all `@opencode-ai/*` → `@nikcli-ai/*`, `Flag.OPENCODE_PURE` → `Flag.NIKCLI_PURE`.

### 5.4 `src/cli/cmd/tui/plugin/internal.ts` _(new)_
Lists all 8 internal plugins:
```ts
export const INTERNAL_TUI_PLUGINS: InternalTuiPlugin[] = [
  HomeTips, SidebarContext, SidebarMcp, SidebarLsp,
  SidebarTodo, SidebarFiles, SidebarFooter, PluginManager,
]
```

### 5.5 `src/cli/cmd/tui/plugin/index.ts` _(new)_
Re-exports `TuiPluginRuntime`, `createTuiApi`, `RouteMap`.

---

## Phase 6 – Feature Plugins

All files in `src/cli/cmd/tui/feature-plugins/`. Replace `@opencode-ai/*` → `@nikcli-ai/*`. Apply PR #19467 typed export pattern (`const plugin: TuiPluginModule & { id: string } = { id, tui }; export default plugin`).

### 6.1 `src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` _(new — renamed from `component/tips.tsx`)_
Move existing `src/cli/cmd/tui/component/tips.tsx` to this path; remove unused `createMemo`, `createSignal` imports (PR diff: only `For` needed).

### 6.2 `src/cli/cmd/tui/feature-plugins/home/tips.tsx` _(new)_
`internal:home-tips` plugin. Registers `tips.toggle` command + `home_bottom` slot.

### 6.3 `src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` _(new)_
`internal:sidebar-context` plugin. Shows token count, context %, and cost.
Replace `AssistantMessage` import with `@nikcli-ai/sdk/v2`.

### 6.4 `src/cli/cmd/tui/feature-plugins/sidebar/mcp.tsx` _(new)_
`internal:sidebar-mcp` plugin. Shows MCP server list with status dots (order 200).

### 6.5 `src/cli/cmd/tui/feature-plugins/sidebar/lsp.tsx` _(new)_
`internal:sidebar-lsp` plugin. Shows LSP server list (order 300).

### 6.6 `src/cli/cmd/tui/feature-plugins/sidebar/todo.tsx` _(new)_
`internal:sidebar-todo` plugin. Shows todo items (order 400). Imports `TodoItem` from `../../component/todo-item`.

### 6.7 `src/cli/cmd/tui/feature-plugins/sidebar/files.tsx` _(new)_
`internal:sidebar-files` plugin. Shows modified files with diff stats (order 500).

### 6.8 `src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx` _(new)_
`internal:sidebar-footer` plugin. Shows "Getting started" panel + path + version.
Update branding text: "OpenCode includes free models" → "NikCLI includes free models" etc.

### 6.9 `src/cli/cmd/tui/feature-plugins/system/plugins.tsx` _(new)_
`internal:plugin-manager` plugin. Full plugin manager dialog with install prompt, enable/disable toggle.
Add `busy`/`busyText` props to `DialogPrompt` usage (PR #19467 addition). Replace `@opencode-ai/*` → `@nikcli-ai/*`.

---

## Phase 7 – `app.tsx` Integration

`src/cli/cmd/tui/app.tsx` _(modify)_

Changes from PR #19347 diff:
1. Import `TimeToFirstDraw` from `@opentui/solid`
2. Import `createCliRenderer`, `CliRendererConfig` from `@opentui/core` (replace `TextAttributes`)
3. Add imports: `ErrorComponent`, `PluginRouteMissing`, `StartupLoading`, `useKeybind`
4. Remove `win32FlushInputBuffer` from win32 imports (moved to error-component)
5. Add solid-js: `createMemo`, `onCleanup`; remove `untrack`
6. Add `TuiPluginRuntime`, `createTuiApi`, `RouteMap` imports from `./plugin`
7. Initialize `TuiPluginRuntime` after SDK/sync are ready; pass `createTuiApi(...)` to it
8. Add `routes: RouteMap` reactive signal and pass to plugin API
9. Add `PluginRoute` handling in main `Switch/Match`: render last registered route or `<PluginRouteMissing>`
10. Wrap `ErrorBoundary` to use `<ErrorComponent>` instead of inline error JSX
11. Add `<StartupLoading>` overlay while plugins are initializing
12. Pass `onBeforeExit` to `ExitProvider` that calls `TuiPluginRuntime.dispose()`
13. Register plugin keybind `plugin_manager` in command system

---

## Phase 8 – CLI `plug` Command

### 8.1 `src/cli/cmd/plug.ts` _(new)_
Full implementation from PR diff (231 lines). `opencode plugin <module>` and `opencode plug <module>` commands.
Replace all `opencode` references with `nikcli` where appropriate in log/UI text.

---

## Critical Files Summary

| File | Action |
|---|---|
| `src/util/network.ts` | Create |
| `src/util/flock.ts` | Create (fetch from opencode) |
| `src/bun/registry.ts` | Create |
| `src/bun/index.ts` | Modify |
| `src/plugin/shared.ts` | Create |
| `src/plugin/meta.ts` | Create |
| `src/plugin/install.ts` | Create |
| `src/plugin/index.ts` | Modify |
| `src/config/tui-schema.ts` | Create (fetch from opencode) |
| `src/config/migrate-tui-config.ts` | Create (fetch from opencode) |
| `src/config/paths.ts` | Create (fetch from opencode) |
| `src/config/tui.ts` | Create |
| `src/flag/flag.ts` | Modify (3 new flags) |
| `packages/plugin/src/index.ts` | Modify |
| `packages/plugin/src/tui.ts` | Create |
| `packages/plugin/package.json` | Modify |
| `src/cli/cmd/tui/context/route.tsx` | Modify |
| `src/cli/cmd/tui/context/sdk.tsx` | Modify |
| `src/cli/cmd/tui/context/keybind.tsx` | Modify |
| `src/cli/cmd/tui/context/exit.tsx` | Modify |
| `src/cli/cmd/tui/context/theme.tsx` | Modify |
| `src/cli/cmd/tui/context/plugin-keybinds.ts` | Create |
| `src/cli/cmd/tui/component/dialog-command.tsx` | Modify |
| `src/cli/cmd/tui/component/dialog-status.tsx` | Modify |
| `src/cli/cmd/tui/component/dialog-workspace-list.tsx` | Modify |
| `src/cli/cmd/tui/component/spinner.tsx` | Create |
| `src/cli/cmd/tui/component/error-component.tsx` | Create |
| `src/cli/cmd/tui/component/plugin-route-missing.tsx` | Create |
| `src/cli/cmd/tui/component/startup-loading.tsx` | Create |
| `src/cli/cmd/tui/plugin/slots.tsx` | Create |
| `src/cli/cmd/tui/plugin/runtime.ts` | Create |
| `src/cli/cmd/tui/plugin/api.tsx` | Create |
| `src/cli/cmd/tui/plugin/internal.ts` | Create |
| `src/cli/cmd/tui/plugin/index.ts` | Create |
| `src/cli/cmd/tui/feature-plugins/home/tips-view.tsx` | Create (move from component/tips.tsx) |
| `src/cli/cmd/tui/feature-plugins/home/tips.tsx` | Create |
| `src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` | Create |
| `src/cli/cmd/tui/feature-plugins/sidebar/mcp.tsx` | Create |
| `src/cli/cmd/tui/feature-plugins/sidebar/lsp.tsx` | Create |
| `src/cli/cmd/tui/feature-plugins/sidebar/todo.tsx` | Create |
| `src/cli/cmd/tui/feature-plugins/sidebar/files.tsx` | Create |
| `src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx` | Create |
| `src/cli/cmd/tui/feature-plugins/system/plugins.tsx` | Create |
| `src/cli/cmd/tui/ui/dialog-prompt.tsx` | Modify |
| `src/cli/cmd/tui/app.tsx` | Modify (major) |
| `src/cli/cmd/plug.ts` | Create |

---

## Verification

After all changes:
1. `bun typecheck` in `packages/nikcli/` — no type errors
2. `bun typecheck` in `packages/plugin/` — no type errors
3. Run the TUI: internal plugins should load and render sidebar panels as before
4. `nikcli plug @some-package` CLI command resolves without crash
5. Plugin manager dialog opens via command palette ("Plugins")
