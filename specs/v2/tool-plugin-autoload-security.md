# Custom Tool Autoload & Pinning Security

| Field  | Value                                                                       |
| ------ | --------------------------------------------------------------------------- |
| Status | **Proposed**                                                                |
| Scope  | `src/tool/registry.ts`, `src/config/config.ts`, `packages/nikcli/AGENTS.md` |

The question this records: how filesystem-based custom tools in config directories are gated, integrity-checked, and safely loaded.

The answer is **a fail-closed security policy**: config directory `{tool,tools}/*.{js,ts}` files are never loaded unless `NIKCLI_ALLOW_PLUGIN_AUTOLOAD=1` or explicit `tool.allow` patterns are configured in `nikcli.json`.

## The Surface

- **Autoload Gate**: Autoload is disabled by default. It activates only when `NIKCLI_ALLOW_PLUGIN_AUTOLOAD` is truthy or `config.tool.allow` is non-empty.
- **Allowlist Filtering**: When `config.tool.allow` is set, only matching file paths or basenames are evaluated.
- **Integrity Pinning**: `config.tool.pin` maps tool paths, basenames, or namespaces to expected SHA-256 hex hashes. A hash mismatch logs an error and aborts loading of that file (fail-closed).
- **In-Process Loading**: Permitted tools are dynamically imported and adapted into standard `Tool.Info` structures.
- **Hot Reload**: Tool derivation is flagged as reloadable (`InstanceState`), automatically updating when config directories change on disk.

## Invariants

- Unconfigured environments never execute unpinned filesystem tool scripts automatically.
- Integrity verification precedes script execution.
- Plugin-contributed tools (`plugin.json` / `Plugin.Service`) load through their own established registry pipeline.
