# Custom Tool Autoload & Pinning Security

| Field  | Value                                                                       |
| ------ | --------------------------------------------------------------------------- |
| Status | **Accepted and implemented** (promoted 2026-09-10)                          |
| Scope  | `src/tool/registry.ts`, `src/config/config.ts`, `packages/nikcli/AGENTS.md` |
| Tests  | `test/plugin/loader.test.ts`                                                |

The question this records: how filesystem-based custom tools in config directories are gated, integrity-checked, and safely loaded.

The answer is **a fail-closed security policy**: config directory `{tool,tools}/*.{js,ts}` files are never loaded unless `NIKCLI_ALLOW_PLUGIN_AUTOLOAD=1` or explicit `tool.allow` patterns are configured in `nikcli.json`.

## The Surface

- **Autoload Gate**: Autoload is disabled by default. It activates only when `NIKCLI_ALLOW_PLUGIN_AUTOLOAD` is truthy or `config.tool.allow` is non-empty.
- **Allowlist Filtering**: When `config.tool.allow` is set, only matching file paths or basenames are evaluated.
- **Integrity Pinning**: `config.tool.pin` maps tool paths, basenames, or namespaces to expected SHA-256 hex hashes. A hash mismatch logs an error and aborts loading of that file (fail-closed).
- **In-Process Loading**: Permitted tools are dynamically imported and adapted into standard `Tool.Info` structures.
- **Hot Reload**: Tool derivation is flagged as reloadable (`InstanceState`), automatically updating when config directories change on disk.

## Invariants

- Unconfigured environments never execute filesystem tool scripts automatically: with `NIKCLI_ALLOW_PLUGIN_AUTOLOAD` unset and `tool.allow` empty, the config directories are never scanned (`ToolRegistry.shouldScanCustomTools`).
- When an allowlist is set, only a matching absolute path, basename, or stem is evaluated (`ToolRegistry.isCustomToolAllowed`).
- A pin is resolved by absolute path, then basename, then namespace, in that order (`ToolRegistry.customToolPin`).
- Integrity verification precedes script execution, and it is fail-closed: a declared pin that does not match the file on disk skips the import instead of loading it (`ToolRegistry.isCustomToolPinSatisfied`). The comparison is case-insensitive, because a pin is copied out of `shasum` output as often as out of this codebase.
- Plugin-contributed tools (`plugin.json` / `Plugin.Service`) load through their own established registry pipeline.

The four decision helpers named above are exported as seams precisely so this is testable: a full `ToolRegistry` init is too heavy for the default unit timeout, and a security rule nobody can run a test against is a comment.

## What Is Explicitly Not Covered

- An absent pin. Pinning is opt-in integrity on top of the autoload gate, not a second gate: an unpinned file inside an enabled config directory loads. An **empty-string** pin reads the same way as an absent one.
- Anything the imported module does once it is loaded. This contract covers whether it is imported.
