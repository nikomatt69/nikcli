# Nikcli Mobile Memory

## Mobile IDE Backend APIs

### Routing

- Backend mounts: `/mobile/*` from `src/server/routes/mobile.ts`, `/file`, `/file/content`, `/find`, `/find/file`, `/find/symbol` from `src/server/routes/file.ts`, `/pty/*` from `src/server/routes/pty.ts`
- Requests scoped by `x-nikcli-directory` or `?directory=...`; workspaces by `x-nikcli-workspace`
- Mobile client sends bearer auth via `Authorization: Bearer <token>` and directory via `x-nikcli-directory`

### Client/Backend Alignment

Git and worktree endpoints live under `/mobile/git/*` and `/mobile/worktree*`. The mobile client scopes requests with `x-nikcli-directory`:

- Session git/file ops: `sessionWorkspaceDirectory(session)` (session cwd first)
- Worktree sandbox ops: parent project `worktree` via `withDirectory()` / `projectDirectoryForWorktree()`

### Client Methods (from `lib/client.ts`)

```
getGitStatus()         -> GET /mobile/git/status
getGitCommits(limit)   -> GET /mobile/git/commits
getGitDiff()           -> GET /mobile/git/diff
stageGitFiles(files)   -> POST /mobile/git/stage { files: string[] }
createGitCommit(msg)   -> POST /mobile/git/commit { message, files?, stagedOnly? } -> { sha, message }
checkoutGitBranch()    -> POST /mobile/git/checkout { branch, create? }
createWorktree()       -> POST /mobile/worktree (scoped via x-nikcli-directory to parent project)
resetWorktree()        -> POST /mobile/worktree/reset { directory }
removeWorktree()       -> DELETE /mobile/worktree { directory }
listDirectory(dir)     -> GET /file?path
readFile(file)         -> GET /file/content?path
writeFile(path, content) -> PUT /file/content
ptyConnectUrl(id)      -> ws(s)://.../mobile/pty/:id/connect?token=...
```

Worktree create/reset/remove require `x-nikcli-directory` to point at the **parent project** worktree, not the sandbox path. Session git/file access uses `sessionWorkspaceDirectory()` for consistent scoping.

### Git Backend Bugs

- `GET /mobile/git/status`: porcelain parsing uses `line.slice(3, 4)` for worktree status but should use `line[1]`; uses `line.slice(4)` for path dropping first char
- `GET /mobile/git/diff`: only runs `git diff --no-color -U1000`; does not include staged diffs (`--staged`) or untracked file content
- `POST /mobile/git/commit`: returns raw `git commit` output as `sha`, should run `git rev-parse HEAD`
- `POST /mobile/git/discard`: uses `git checkout -- <files>` which doesn't remove untracked files

### File Backend Bugs

- `File.read()` trims content with `.trim()`, losing leading/trailing whitespace
- `PUT /file/content` does not check `Instance.containsPath`; read/list do check
- No file create/delete/rename/mkdir endpoints exist
- Absolute path handling: client passes absolute paths, backend re-joins with `Instance.directory` causing duplication

## GitHub OAuth Persistence Bug

**Root cause**: GitHub OAuth token stored server-side in `${Global.Path.data}/connectors-auth.json` (XDG: `~/.local/share/nikcli`). Mobile only stores server config in SecureStore (`nikcli_server_config`).

**Bug**: If nikcli host server restarts/redeploys or runs under different home/XDG path, `connectors-auth.json` disappears. On app reopen, `/mobile/bootstrap` recomputes `github.connected` and sees missing token → re-requests OAuth.

**Fix**: Make `${Global.Path.data}` durable (persist/mount volume). Add configurable `NIKCLI_DATA_DIR` env/flag in `src/global/index.ts` for hosted deployments.

**Relevant files**: `packages/nikcli/src/global/index.ts`, `packages/nikcli/src/connectors/auth.ts`, `packages/nikcli/src/server/routes/mobile.ts`

## PTY/WebSocket Terminal

### Connection Issues

Terminal stuck in "Connecting..." when many agents running. Root causes:

- Railway proxy doesn't handle WebSocket upgrades natively
- Timeout too short (10s) under server load
- No retry logic

### Terminal.html Improvements (2026-04-30)

- Timeout increased: 10s → 30s
- Auto-retry: up to 3 attempts with 2s delay
- Error overlay showing actual WebSocket URL for debugging
- Retry button in error state
- `TerminalWebView` added error state with retry option

### WebSocket Auth Fix (2026-04-30)

Fixed in `packages/nikcli/src/server/server.ts:161`:

```typescript
const bearer = MobileAuth.bearer(c.req.raw) || c.req.query("token")
```

Token now accepted from query parameter for WebSocket connections (cannot send custom headers in WS).

### WebSocket Auth Security Issues (Code Review 2026-04-30)

| Priority | Issue                                                                 | Fix                                                 |
| -------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| CRITICAL | Token leaks in server logs via `c.req.path` (includes `?token=...`)   | Strip query params: `c.req.path.split("?")[0]`      |
| CRITICAL | Timing attack in `MobileAuth.verify()` — uses `===` not constant-time | Use `crypto.timingSafeEqual()` for hash comparison  |
| MEDIUM   | Railway proxy logs full URLs including query params                   | Configure Railway to exclude sensitive query params |
| MEDIUM   | No CORS headers on WebSocket upgrade response                         | Add in `upgradeWebSocket` handler if cross-origin   |

## Mobile Stack

Expo 52, React Native 0.76, NativeWind, lucide-react-native, expo-router, react-native-webview, zustand, Expo SecureStore.

### Key Architecture

- **Root layout** (`app/_layout.tsx`): ServerProvider, auth guard, Stack
- **App shell** (`app/(app)/_layout.tsx`): custom Tabs with AppHeader + AppTabBar
- **Auth**: server pairing token (`ServerConfig.token`) + user session token (`USER_TOKEN_KEY`)
- **Data**: direct `MobileClient` calls; Zustand for UI prefs, SecureStore for config
- **Terminal**: WebView-backed PTY with `@wterm/dom` loaded via esm.sh CDN

### Known Issues (2026-04-30)

- `SessionComposer.tsx`: Plus button now opens `ComposerToolDrawer` (full drawer with all tabs)
- `SessionComposer.tsx:653`: stop button `onPress` only triggers haptics; `onStop` prop accepted but never wired
- Terminal safe-area: uses `SafeAreaView` but screen already has app chrome (inner screen shouldn't double-pad)
- Terminal: `client!` on retained tabs; host disconnect after tabs exist can crash — needs null guard
- `AppHeader.tsx:133`, `DrawerMenu.tsx:199`: icon-only `Pressable`s lack `accessibilityRole`/`accessibilityLabel`

### PTY Data Shapes

```typescript
PtyInfo: { id, title, command, args, cwd, status: "running"|"exited", pid }
PtyCreateInput: { command?, args?, cwd?, title?, env? }
PtyUpdateInput: { title?, size?: { rows, cols } }
```

### Session APIs

```typescript
listSessions(search?) -> GET /mobile/session?search?
createSession(input?) -> POST /mobile/session
getSession(id) -> GET /mobile/session/:id
sendParts(...) -> POST /mobile/session/:id/message
sendCommand(...) -> POST /mobile/session/:id/command
abortSession(...) -> POST /mobile/session/:id/abort
respondToPermission(...) -> POST /mobile/session/:id/permissions/:pid
getDiff(id, msgId) -> GET /mobile/session/:id/diff/:msgId
sessionStreamUrl(id) -> SSE /mobile/session/:id/stream
```

Stream events: `server.connected`, `server.heartbeat`, `message.updated`, `message.part.updated`, `session.updated`, `session.status`, `session.idle`, permission events.

## Storage

- `lib/storage.ts`: SecureStore with key `nikcli_server_config` → `ServerConfig` (url, token, directory, model prefs, execution target)
- `lib/offline.ts`: offline storage support
- No AsyncStorage usage; all local persistence via `expo-secure-store`

## Code Reviewer Remaining Concerns (TUI)

- `decodeDataUrlTextPayload()` needs base64 padding normalization for unpadded inputs
- ACP replay (`agent.ts:742`) lacks generic data URL parsing for non-base64 text resources
- ACP mode validation should use same session cwd filtering as `loadSessionMode()`
- Image preview (`image-preview.tsx`): avoid `text-` prefix in element IDs, use `flexShrink={0}` wrappers, ignore reasoning parts for URL extraction
- TUI markdown rendering is fully owned by OpenTUI; no local link-render hook available
