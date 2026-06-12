# TUI Command Shim Removal

## Status (2026-06-12)

- The runtime shim is gone: `command-shim.ts` and `createCommandShim` no
  longer exist; `api.command` is implemented natively against the host
  command dialog in `plugin/api.tsx` / `plugin/runtime.ts`.
- The keymap surface now exists: `api.keymap.registerLayer({ commands,
bindings })` and `api.keymap.dispatchCommand(name)` are implemented in
  `src/cli/cmd/tui/plugin/keymap.ts` (types `TuiKeymap*` in
  `packages/plugin/src/tui.ts`), with unit tests in
  `test/tui/plugin-keymap.test.ts`. `dispatchCommand("command.palette.show")`
  opens the host palette.
- Decision change vs. the plan below: `TuiPluginApi.command` is kept as a
  **deprecated** alias (JSDoc `@deprecated`) instead of being deleted,
  because external plugins and `specs/tui-plugins.md` still document it.
  Delete it (and `TuiCommand` from the public surface) in the next plugin
  API major.

Problem:

- v1 keeps a deprecated `api.command` TUI plugin shim so older plugins do not fail during initialization
- v2 should expose only the keymap command API
- tests and fixtures should not encode legacy command behavior as expected behavior

## Remove Public Types

In `packages/plugin/src/tui.ts`, remove:

- `TuiCommand`
- `TuiCommandApi`
- `TuiPluginApi.command`

Keep `api.keymap` as the only TUI command registration and execution surface.

## Remove Runtime Shim

Delete `packages/nikcli/src/cli/cmd/tui/plugin/command-shim.ts`.

In `packages/nikcli/src/cli/cmd/tui/plugin/api.tsx`, remove:

- the `createCommandShim` import
- the `command: createCommandShim(...)` field from `createTuiApi(...)`

In `packages/nikcli/src/cli/cmd/tui/plugin/runtime.ts`, remove:

- the `createCommandShim` import
- the `command: createCommandShim(...)` field from `pluginApi(...)`

## Migration Target

Plugin authors should replace old calls with keymap calls:

```ts
api.keymap.registerLayer({
  commands: [
    {
      name: "plugin.command",
      title: "Plugin Command",
      namespace: "palette",
      slashName: "plugin",
      run() {
        api.ui.dialog.clear()
      },
    },
  ],
  bindings: [{ key: "ctrl+shift+p", cmd: "plugin.command" }],
})
```

Direct replacements:

- `api.command.register(cb)` -> `api.keymap.registerLayer({ commands, bindings })`
- `api.command.trigger(name)` -> `api.keymap.dispatchCommand(name)`
- `api.command.show()` -> `api.keymap.dispatchCommand("command.palette.show")`
- `onSelect(dialog)` -> use `api.ui.dialog` from the plugin API closure

## Verification

After removal, run from package directories:

- `bun typecheck` in `packages/plugin`
- `bun typecheck` in `packages/nikcli`
- TUI plugin loader tests in `packages/nikcli` if runtime plugin API wiring changed
