# nikcli Repository

## Key Commands

- **Test nikcli**: `bun run dev` in `packages/nikcli`
- **Regenerate JavaScript SDK**: `./packages/sdk/js/script/build.ts`
- **ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE**
- **Default branch**: `dev`

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

## Important Rules

1. **No mocks/placeholders**: All code must be production-ready, no TODO/FIXME placeholders
2. **Minimize new files**: Prefer modifying existing files over creating new ones
3. **Parallel execution**: Use background tasks for independent work
4. **SDK regeneration**: After modifying server endpoints in `packages/nikcli/src/server/server.ts`, regenerate the SDK
