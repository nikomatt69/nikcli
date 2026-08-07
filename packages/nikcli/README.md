# nikcli

> **A fork of [OpenCode](https://github.com/anomalyco/opencode)** — the open source coding agent. 
> Credit for the original project goes to the OpenCode authors and contributors. nikcli is an
> independent fork, not affiliated with or endorsed by them.

nikcli is a Bun-based AI coding agent combining a terminal UI, an HTTP server API, external service connectors, and a mobile companion app.

nikcli is an AI-powered development tool with connectors, a mobile companion, and a structured CLI command surface.

## Quickstart

```bash
# 1. Install (one of the methods below)
curl -fsSL https://nikcli.store/install | bash

# 2. Run the TUI
nikcli

# 3. Or run a one-shot prompt from the shell
nikcli run "explain this codebase"
```

Inside the TUI, the one shortcut to remember is **Ctrl+P** — it opens the command palette with every available action, slash command, and provider. From there, the `?` in the bottom-right footer hints shows the same.

| Surface         | Entry               |
| --------------- | ------------------- |
| Terminal UI     | `nikcli` (default)  |
| HTTP API        | `nikcli serve`      |
| Mobile host     | `nikcli mobile`     |
| Remote sessions | `nikcli remote`     |
| Connectors      | `nikcli connectors` |
| Bots            | `nikcli bot`        |

Run `nikcli --help` to see all available commands.

## Install

| Method | Command                                                           |
| ------ | ----------------------------------------------------------------- |
| curl   | `curl -fsSL https://nikcli.store/install \| bash`                 |
| npm    | `npm install -g nikcli-ai`                                        |
| pnpm   | `pnpm install -g nikcli-ai`                                       |
| bun    | `bun install -g nikcli-ai`                                        |
| brew   | `brew install nikcli` (or `nikomatt69/tap/nikcli` if not on core) |
| scoop  | `scoop install nikcli`                                            |
| choco  | `choco install nikcli`                                            |

`nikcli upgrade` picks the same method you installed with. `nikcli --version` prints the current version without mutating state.

## Development

```bash
bun install
bun dev
```

Local development runs the CLI entrypoint at `packages/nikcli/src/index.ts`.

## Packages

| Package           | Purpose                                    |
| ----------------- | ------------------------------------------ |
| `packages/nikcli` | CLI, TUI, agent engine, server, connectors |
| `packages/mobile` | Expo mobile companion app                  |
| `packages/web`    | Documentation site (nikcli.store)          |
| `packages/sdk`    | Shared TypeScript SDK                      |

## Resources

- [Documentation](https://nikcli.store/docs)
- [Configuration reference](https://nikcli.store/docs/configuration)
- [CLI reference](https://nikcli.store/docs/cli)

## Specs

In-repo design and roadmap documents for contributors:

- [`specs/integration-plan-verified.md`](./specs/integration-plan-verified.md) — the verified internal-refactor roadmap (Effect services, Hono→HttpApi, schema, ALS, `packages/server` extraction). 9 phases, ordered by dependency.
- [`specs/ROADMAP.md`](./specs/ROADMAP.md) — the canonical product and engineering roadmap.
- [`specs/effect/`](./specs/effect/) — detailed Effect-migration specs feeding the integration plan.
- [`specs/v2/`](./specs/v2/) — v2 API surface and TUI/keymap/notifications/message-shape specs.
