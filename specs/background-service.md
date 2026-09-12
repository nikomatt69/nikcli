# Background service

## Why

Every `nikcli` invocation evaluates the whole engine graph in its own process:
~988K `Function` objects, ~23K `FunctionExecutable`, ~125 MB of JS heap, and
~423 MB peak RSS on the compiled binary — paid again on every start, and paid a
second time by the TUI's worker thread, which is a separate isolate.

opencode v2 does not pay this per invocation. Its CLI process is thin and the
session engine lives in a **persistent background service** that every client
connects to over HTTP (`packages/cli/src/server-process.ts`, plus its
`service start/stop/status/restart` commands). The engine graph is evaluated
once per machine and stays warm across invocations.

nikcli already has every piece this needs:

- `Server.listen()` binds a real HTTP server (`server/server.ts`).
- `nikcli serve --stdio` prints `{"url":"..."}` on stdout once `/global/health`
  answers — a readiness handshake explicitly "for parent processes".
- `GET /global/health` is public and returns `{ healthy, version, revision? }`,
  which is both the liveness probe and the version check.
- The HTTP API is **directory-scoped** already (`x-nikcli-directory` header or
  `?directory=`), so one global service serves every project.
- `nikcli attach <url>` runs the complete TUI against an external server in 38
  lines — no worker thread, no custom `fetch`, no synthetic origin.
- `serve` already suspends active sessions on shutdown and resumes them on the
  next start (`specs/v2/session-restart-continuation.md`).

So this is lifecycle management on top of `serve --stdio`, not a rewrite.

## Model

One service per **channel**, per data directory, on loopback. Two things follow
from "per channel" that are easy to miss and expensive to get wrong:

- The registration file is `service.json` for the shared channels
  (`latest`/`dev`/`beta`/`next`) and `service-<channel>.json` otherwise. Without
  it a `local` dev build and an installed release discover *each other's*
  service and restart it on every version check, forever.
- The default port is per channel too — `0xc0de` shared, `0xc0df` local,
  otherwise hashed into 10000-60000 — so two builds never race for one socket.
  `serve` still falls back to an ephemeral port when it is taken and the
  registration records what was actually bound, so nothing depends on it.

```json
{ "id": "9f2c…", "pid": 1234, "url": "http://127.0.0.1:49374", "version": "1.348.0", "startedAt": 1757680000000 }
```

**The service writes and removes its own registration** (`serve --service`), and
the client polls discovery rather than reading a handshake off a pipe: a spawned
daemon whose stdout stays piped to a parent that then exits takes EPIPE on its
next write, so a true daemon wants every stdio stream ignored. The write is
`temp file + rename` at mode `0600`, so a client polling during startup never
parses a half-written file.

### One service per channel, enforced by the service itself

Each instance stamps a random `id`. A watchdog re-reads the registration every
5s and, if the entry is no longer its own, **stands the process down**. Cleanup
on shutdown is ownership-checked for the same reason, so an older instance
exiting cannot delete its successor's entry.

That, not locking, is what keeps two services from serving one channel
indefinitely: the client-side lock only narrows the spawn race, while this
resolves it after the fact no matter how two instances came to exist.

### Discovery

`BackgroundService.discover()` returns a live service or `undefined`, believing
a registration only after all three checks pass — cheapest first:

1. The file parses and names a pid.
2. `process.kill(pid, 0)` says the process exists.
3. `GET /global/health` answers `healthy: true` within a short timeout.

Any failure means "not running": the entry is stale and gets removed. A stale
file must never be fatal — a machine that crashed mid-session should start
cleanly, not report an error.

### Version skew

Health returns the service's version, and a client must never drive a service
built from different code — both sides of the HTTP contract are generated from
one source tree. The check is **channel-aware**, not exact equality: preview
channel versions carry a build counter (`0.0.0-<channel>-<n>`), so requiring
equality would read every rebuild as skew, restart the service each time, and
leave the engine permanently cold — the exact opposite of the point.

### Start

Spawn `serve --service --port <configured or channel default> --hostname
127.0.0.1` with `detached: true` (verified to place the child in its own process
group, so Ctrl+C in the client's terminal does not reach it), every stdio stream
ignored, and the handle `unref`'d. Then poll `discover()` until healthy, or give
up after the start timeout.

Two clients starting at once race, so start is guarded by an atomic
`service.lock` created with `wx`; whoever loses polls discovery until the winner
registers. A lock older than the start timeout is treated as abandoned — a client
killed mid-spawn must not wedge every later start.

### Settings

`nikcli service get|set|unset` persist `hostname`, `port`, `cors` and `env` next
to the registration, per channel, and `start` applies them. Clients spawn the
service, so there is nowhere to pass these at the moment it actually starts;
this file is that "nowhere". **Every mutation stops the running service** — a
setting that only takes effect after the user happens to restart is a setting
that looks broken.

### Stop

`SIGTERM` to the pid; `serve` already handles it by suspending live sessions so
the next start resumes them. Wait for the process to disappear, then remove the
registration; `SIGKILL` only if it outlasts the stop timeout.

### Deliberate differences from opencode

- **No per-service password.** opencode stamps one into the registration and
  requires it on every request. nikcli binds loopback and already has
  `NIKCLI_SERVER_PASSWORD`; adding another would change what every client must
  send, and any local process can read the registration file either way.
- **yargs, not `effect/unstable/cli`.** opencode's spec lives in one
  dependency-free `commands/commands.ts` with handlers under
  `commands/handlers/`. nikcli keeps yargs and puts the static spec at the
  registration site in `cli-main`; the property that matters — `--help`, command
  matching and completion never load a handler — is the same, and the framework
  swap would be a rewrite of all ~44 command builders.

## Measured

TUI booted under `@nikcli-ai/terminal-control` in a fresh test home; **peak** RSS
of the process tree, sampled every 2s over a **fixed 30s dwell after first
paint**. The dwell has to be fixed: an adaptive wait (`stable`) settles at
different times in the two modes, compares two different load states, and
reported this backwards the first time it was run.

| | client | service | total |
| --- | ---: | ---: | ---: |
| in-process, eager commands (before) | 973 MB | — | 975 MB |
| service, eager commands | 412 MB | 517 MB | 929 MB |
| in-process, lazy commands | 819 MB | — | 821 MB |
| **service + lazy commands** | **340 MB** | 450 MB | **790 MB** |

What the table says, which is not what you would guess:

- **The service's win is the client, not the total.** 973 → 412 MB eager,
  819 → 340 MB lazy: roughly −58% either way. The total barely moves (975 → 929
  eager) because the engine does not disappear, it relocates. The real payoff is
  amortisation — a second concurrent TUI costs another 340 MB client, not another
  engine — and it needs more than one client to show up at all.
- **Lazy commands are worth less in-process than the module graph suggests.**
  `@/cli-main` drops 364 → 127 MB, but in-process RSS only 975 → 821 MB, because
  the TUI worker still loads a full engine in its own isolate no matter what the
  main thread skipped. The two changes compose: together, 975 → 790 MB total and
  973 → 340 MB for the client.

## Command registration

`cli-main` imported all ~44 command modules eagerly. Because `run [message..]`
pulls the whole engine, the main thread loaded a complete engine graph *and* the
TUI worker loaded another in its own isolate — two engines per session, to run a
command that is almost always the default TUI.

Registering through `lazy()` (`src/cli/cmd/lazy.ts`) takes `@/cli-main` from
**988K `Function` / 125 MB heap / ~364 MB RSS / ~745 ms eval** to
**154K / 26 MB / ~127 MB / ~237 ms**, and `nikcli heap` from 0.90s to 0.40s warm.

This is the change commit `1e6e0ce304` made and had reverted for making the tool
worse. Three differences:

1. `$0` — the interactive TUI — stays eager. Only named, one-shot commands defer.
2. Nothing gets slower. Under eager registration *every* invocation paid for all
   44 command modules, so each command now loads strictly less than before.
3. `describe` and `command` stay at the registration site, so `--help`, command
   matching and completion never load a handler. yargs awaits an async `builder`,
   so per-command flags still parse identically; `test/cli/lazy-commands.test.ts`
   holds each duplicated spec to the module it points at.

## Rollout

**On by default**, matching opencode, whose `--standalone` flag means "run with a
private server instead of the background service". nikcli's TUI takes the same
shape:

| | path |
| --- | --- |
| `nikcli` | shared background service |
| `nikcli --standalone` | private in-process server |
| `NIKCLI_SERVICE=0` | private in-process server |
| `--port` / `--hostname` / `--mdns` | private server, since the caller wants their own listener |
| `NIKCLI_DRIVE` (simulation) | private, always — the deterministic mock lives in the client |
| `NIKCLI_TEST_HOME` set | private, unless `NIKCLI_SERVICE=1` |

The test-home rule is not cosmetic. A service outlives its client by design, so a
suite that boots the TUI would leave one daemon per test home behind, and stray
nikcli processes are already a documented cause of bogus measurements and flaky
runs. Tests that *want* the service ask for it with `NIKCLI_SERVICE=1`.

A service that will not start is not fatal: the client logs a warning and falls
through to the private path. The failure modes are environmental — a wedged port,
a killed spawn — and a user who cannot open their editor has a worse problem than
a cold engine.

The one behaviour change to know about: **a session now outlives the client**.
Closing the TUI no longer stops the work; `nikcli service stop` does.

Upgrade runs in the *client*, not the service: it replaces the installed binary,
and the service is a different (older) copy of it. After an upgrade the running
service is on the previous version, and the next client restarts it on the version
skew check.

## Not in scope here

- Lazy command handlers with a static spec. They only pay off once the engine is
  out of the CLI process — before that, deferring a command module just relocates
  the monolith, which is why the previous attempt was reverted. Revisit after the
  service is the default.
- Service supervision (restart on crash) and idle shutdown.
