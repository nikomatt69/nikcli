# nikcli Repository

nikcli is a fork of [OpenCode](https://github.com/anomalyco/opencode). Much of the structure below comes from
there — when in doubt about why something is shaped the way it is, check upstream first.

## Key Commands

- **Test nikcli**: `bun run dev` in `packages/nikcli`
- **Regenerate HTTP clients**: `bun run generate:httpapi-clients` in `packages/nikcli`
- **ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE**
- **Default branch**: `live-main`

## Monorepo Structure

This is a Bun monorepo. Key packages:

- `packages/nikcli` - Main CLI application
- `packages/sdk` - API client SDK
- `packages/studio` - Desktop UI
- `packages/plugin` - Plugin system
- `packages/remote` - Remote execution
- `packages/companion` - Companion services

## Development Guidelines

- **Package manager**: Bun (use `bun install`, `bun update`)
- **Type checking**: `bun run typecheck`
- **Testing**: `bun test` (single file: `bun test test/path/file.test.ts`)
- **Build**: `bun run build`
- **HttpApi route coverage** (nikcli): `bun run check:routes` in `packages/nikcli`. `--strict` is honored as of 2026-08-17 (H4 landed `AccountGroup` + `ConfigManagementGroup.profilesList`; the script reads `process.argv`). Today `--strict` is the same rules as default; future strict-only checks land in `script/check-route-coverage.ts`.

## HTTP integration

The nikcli server is Effect `HttpApi` on `Bun.serve`. There is no Hono app.
The contract lives in `packages/nikcli/src/server/httpapi/*` and **is** the
source for both OpenAPI and the generated clients.

To change any HTTP endpoint: edit the group in `src/server/httpapi/`, then run
`bun run generate:httpapi-clients` from `packages/nikcli`. Full workflow,
schema rules, and verification steps are in `packages/nikcli/AGENTS.md`
("HTTP integration workflow").

Consumers import `@nikcli-ai/sdk/httpapi`. There is no hey-api step and no
`v2` client any more — `packages/sdk/js/script/build.ts` now regenerates from
the contract and emits `dist`, so running it is safe.

## Important Rules

1. **No mocks/placeholders**: All code must be production-ready, no TODO/FIXME placeholders
2. **Minimize new files**: Prefer modifying existing files over creating new ones
3. **Parallel execution**: Use background tasks for independent work
4. **Client regeneration**: After changing an HTTP contract in `packages/nikcli/src/server/httpapi/`, run `bun run generate:httpapi-clients` and commit the generated output
5. **Custom tool autoload**: config-dir `tool/*.ts` requires `NIKCLI_ALLOW_PLUGIN_AUTOLOAD=1` or `tool.allow`/`tool.pin` — see `packages/nikcli/AGENTS.md`
