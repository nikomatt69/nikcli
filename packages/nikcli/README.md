# nikcli

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

- [`specs/integration-master-plan.md`](./specs/integration-master-plan.md) — the authoritative internal-refactor roadmap (Effect services, Hono→HttpApi, schema, ALS, `packages/server` extraction). 9 epochs, ordered by dependency.
- [`specs/ux-roadmap.md`](./specs/ux-roadmap.md) — the user-facing UX / TUI / onboarding roadmap. What the end user sees, clicks, types, reads, and feels. Complement to the integration plan; sequenced independently. Batch 1 is the "new user can succeed" set.
- [`specs/effect/`](./specs/effect/) — detailed Effect-migration specs feeding the integration plan.
- [`specs/v2/`](./specs/v2/) — v2 API surface and TUI/keymap/notifications/message-shape specs.
