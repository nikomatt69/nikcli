# nikcli

nikcli is a Bun-based AI coding agent combining a terminal UI, an HTTP server API, external service connectors, and a mobile companion app.

nikcli is an AI-powered development tool with connectors, a mobile companion, and a structured CLI command surface.

## Core Surfaces

| Surface         | Entry               |
| --------------- | ------------------- |
| Terminal UI     | `nikcli` (default)  |
| HTTP API        | `nikcli serve`      |
| Mobile host     | `nikcli mobile`     |
| Remote sessions | `nikcli remote`     |
| Connectors      | `nikcli connectors` |
| Bots            | `nikcli bot`        |

Run `nikcli --help` to see all available commands.

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
