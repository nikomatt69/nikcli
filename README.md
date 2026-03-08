# Nikcli

AI-powered development tool with a CLI and a TUI.

Creator: nikomatt69 (GitHub: https://github.com/nikomatt69, X: https://x.com/nikomatt69)

Upstream notice: Nikcli is based on an upstream open-source project.

Credits: upstream project and contributors (see repository history).

## What it is

- CLI with a TUI default entrypoint (`packages/nikcli/src/cli/cmd/tui/`).
- Local execution uses Bun; CLI entrypoint is `packages/nikcli/src/index.ts`.
- TUI uses a worker process and supports remote attach via `nikcli attach <url>`.
- Server mode exposes HTTP + SSE endpoints on Hono with OpenAPI generation (`packages/nikcli/src/server/`).
- Default agents: `build` (full permissions) and `plan` (read-only).
- Subagents include `general`, `explore`, `@fast-explore`, `@planner`, `@code-reviewer`, `@debugger`, `@test-runner`, `@refactor`.

## Install script

The installer script downloads release assets from `nikcli.store` with GitHub releases as fallback (see `packages/web/install`).

```bash
curl -fsSL https://nikcli.store/install | bash
nikcli
```

## From source

```bash
bun install
bun run --cwd packages/nikcli --conditions=browser src/index.ts
```

## CLI quickstart

```bash
nikcli --help
```

Core commands (see `packages/nikcli/src/cli/cmd/`):

- `run [message..]`
- `generate`
- `auth`
- `agent`
- `models`
- `serve`
- `web`
- `remote-control`
- `remote start` / `remote status` (compat)
- `attach <url>`
- `upgrade` / `uninstall`
- `github install`

## Configuration

Config resolution order (lowest to highest):

1. Remote: `/.well-known/nikcli` for OAuth providers
2. Global: `~/.config/nikcli/nikcli.jsonc` (or `nikcli.json`, `config.json`)
3. Custom path: `NIKCLI_CONFIG` or `NIKCLI_CONFIG_CONTENT`
4. Project: `nikcli.jsonc` or `nikcli.json` discovered upward

Schema: https://nikcli.store/config.json

## Docs

https://nikcli.store/docs

## License

MIT (see `LICENSE`).
