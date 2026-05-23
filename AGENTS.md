# nikcli Repository

## Key Commands

- **Test nikcli**: `bun run dev` in `packages/nikcli`
- **Regenerate JavaScript SDK**: `./packages/sdk/js/script/build.ts`
- **ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE**
- **Default branch**: `nikoemme-main`

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

## Docker Serve (local dev)

Run the nikcli server locally via Docker, accessible from browser and mobile on the same LAN.

### Quick start
```powershell
.\script\serve.ps1
```

### Manual
```powershell
$env:HOST_IP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch "Loopback|Bluetooth|vEthernet|WSL|Default Switch" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1 -ExpandProperty IPAddress)
docker compose -f docker-compose.serve.yml up -d
```

### Connect
- **Web App**: https://nikcli.store/app/connect → paste `nikcli://connect?...` deep link (auto-generated at startup, get it with `docker logs nikcli-serve 2>&1 | Select-String "Deep Link"`)
- **Mobile** (same WiFi): `http://<LAN_IP>:4096` / user `nikcli` / pass `dev123`
- **Terminal**: `curl -u nikcli:dev123 http://localhost:4096/global/health`

### Rebuild
```powershell
docker compose -f docker-compose.serve.yml down
docker build -t nikcli-serve:latest -f Dockerfile.serve .
docker compose -f docker-compose.serve.yml up -d
```

### Notes
- `Dockerfile.serve` runs nikcli from source via `bun run`, not the compiled binary — faster rebuilds
- Permanent password auth (`dev123`), no token regeneration needed for mobile
- Web app uses Bearer token (generate via `mobile pair`) — password is for mobile app/terminal only
- Auto-detects LAN IP via `HOST_IP` env var
- Data persisted in Docker volume `nikcli-data`
