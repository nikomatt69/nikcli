# nikcli — UX / TUI / Onboarding Roadmap

> **Status:** Draft for review.
> **Date:** 2026-06-02.
> **Owner:** TBD (proposed: TUI working group).
> **Companion to:** [`specs/integration-master-plan.md`](./integration-master-plan.md) (which covers internal refactor work in Epochs 1–9). This spec covers only what the end user sees, clicks, types, reads, and feels.

---

## 0. Reading guide

**Format chosen:** vision + priorities. Each item is one line, tagged with priority and rough effort. No mockups, no microcopy — those are the next layer of work after the team aligns on priorities.

**Legend**

- **P0** — blocks new users from succeeding. Ship first.
- **P1** — strongly improves the experience but they can limp through.
- **P2** — quality of life. Bundle opportunistically.
- **Effort:** **S** < 1 day · **M** 1–3 days · **L** 3–10 days.

**Source.** Every item below is grounded in a 4-agent parallel investigation of `packages/nikcli/src/`. Agents covered: (1) architecture/runtime, (2) TUI/UX (132 files, ~42k LOC, including the 3,256-LOC `routes/session/index.tsx` and 2,264-LOC `component/prompt/index.tsx`), (3) config/auth/onboarding, and (4) cross-cutting UX risks (silent prompt failures, streaming indicators, fragile Ctrl+C, missing confirmations, toast cap, theme picker scale). Item 5 (full error-flow/new-user journey) was not run; themes C and M cover the high-leverage parts.

> **Note on `src/chatbot/`:** this directory is a Discord/Slack/Teams bridge, **not** the chat UI. The chat UI lives inside the TUI at `src/cli/cmd/tui/routes/session/index.tsx` and `src/cli/cmd/tui/component/prompt/index.tsx`. If you are searching for "where is chat rendered?", land on the TUI route, not the bridge.

**Scope chosen (per author).** UX/TUI/Onboarding only. No DX, no architecture, no refactor.

**Where to start reading.**

- If you are a maintainer triaging: read §1 (vision) + §4 (sequencing) + §7 (open questions). 5 minutes.
- If you are picking up a P0: read §3 themes A, B, C, D, H + §3 theme M (real bugs). 20 minutes.
- If you are a new contributor: read §2 (what already exists) + §3 in full. 45 minutes.

---

## 1. Vision

**Make the first 10 minutes feel guided, the next 10 hours feel powerful, the next 10 days feel inevitable.**

Today nikcli has all the building blocks — a 600-line 4-step onboarding wizard (`packages/nikcli/src/cli/cmd/tui/component/dialog-onboarding.tsx`), 40+ command-palette commands (10 of them `hidden: true` in `packages/nikcli/src/cli/cmd/tui/app.tsx`), a 39-line help dialog that says only "press `<command_list>`" (`packages/nikcli/src/cli/cmd/tui/ui/dialog-help.tsx`), and a Tips strip that is _hidden_ for first-time users (`packages/nikcli/src/cli/cmd/tui/routes/home.tsx:38-42`). The problem is **order, explanation, recovery, and discoverability** — not missing features.

The five moments that ladder to this vision:

1. **First run** — understand what nikcli is _before_ being asked to sign up.
2. **First minute** — have a working provider, a model, and a one-line answer to "what now?".
3. **First session** — get a useful response to a real task and understand the cost.
4. **First hour** — discover slash commands, sessions, agents, and the workspace panel by _doing_, not by reading.
5. **First week** — have a setup worth keeping and tell a teammate how to get the same.

---

## 2. What already exists (don't reinvent)

| Area                                                                                                          | Asset                                                                                                                                                                              | Path                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Onboarding                                                                                                    | 4-step wizard (Welcome → Account → Filesystem → Connect)                                                                                                                           | `packages/nikcli/src/cli/cmd/tui/component/dialog-onboarding.tsx` (600 lines)     |
| Auth                                                                                                          | `auth login/list/logout`, OAuth + API key + well-known                                                                                                                             | `packages/nikcli/src/cli/cmd/auth.ts`                                             |
| Provider picker                                                                                               | `DialogProviderList` (auto-shown when empty)                                                                                                                                       | `packages/nikcli/src/cli/cmd/tui/component/dialog-provider.tsx`                   |
| Command palette                                                                                               | 40+ commands, slashes, `suggested` mode                                                                                                                                            | `packages/nikcli/src/cli/cmd/tui/component/dialog-command.tsx` + `app.tsx`        |
| Slash commands                                                                                                | ~20: `/sessions /models /agents /skills /mcps /themes /status /usage /preview /brain /config /help /auth /connect /disconnect /new /workspace /changes /tree /graph /github /exit` | `app.tsx`                                                                         |
| Help                                                                                                          | `DialogHelp` (39 lines, stub)                                                                                                                                                      | `packages/nikcli/src/cli/cmd/tui/ui/dialog-help.tsx`                              |
| Tips                                                                                                          | Idle tips, hidden for first-time users                                                                                                                                             | `packages/nikcli/src/cli/cmd/tui/component/tips.tsx`                              |
| Footer hints                                                                                                  | Action-based keybinds                                                                                                                                                              | `packages/nikcli/src/cli/cmd/tui/ui/footer-hints.tsx`                             |
| Theme                                                                                                         | Dark/light, picker, creator                                                                                                                                                        | `packages/nikcli/src/cli/cmd/tui/context/theme/`                                  |
| Status / Usage / Analytics / Models / Variant / Skills / MCPs / Auth / Workspaces / Sessions / GitHub / Brain | All exist as dialogs                                                                                                                                                               | `packages/nikcli/src/cli/cmd/tui/component/dialog-*.tsx`                          |
| Install / upgrade / uninstall                                                                                 | 8 install methods, `--dry-run`, context-aware errors                                                                                                                               | `packages/nikcli/src/installation/`, `cli/cmd/upgrade.ts`, `cli/cmd/uninstall.ts` |
| Telemetry                                                                                                     | `analytics.view` command                                                                                                                                                           | `packages/nikcli/src/analytics/`, `dialog-analytics.tsx`                          |
| README                                                                                                        | 43 lines, bare                                                                                                                                                                     | `packages/nikcli/README.md`                                                       |
| Docs                                                                                                          | 5 markdown files, including TUI plugins spec                                                                                                                                       | `packages/nikcli/specs/`, external `nikcli.store/docs`                            |
| Notifications                                                                                                 | Notify plugin (macOS / Slack / Discord, rate-limited, circuit-broken, quiet hours)                                                                                                 | `packages/nikcli/src/plugin/index.ts:1-620`                                       |
| Connectors                                                                                                    | 9: Figma, Slack, GitHub, Lovable, Discord, Teams, GChat, Linear                                                                                                                    | `packages/nikcli/src/config/config.ts:541-635`                                    |
| MCPs                                                                                                          | Local (stdio) + Remote (HTTP/SSE) + OAuth                                                                                                                                          | `packages/nikcli/src/mcp/`, `config/config.ts:478-538`                            |
| Bundled providers                                                                                             | 20+ AI SDK providers pre-bundled, no `npm install`                                                                                                                                 | `packages/nikcli/src/provider/provider.ts:385-410`                                |
| LAN discovery                                                                                                 | mDNS publish + Tailscale auth headers                                                                                                                                              | `packages/nikcli/src/server/server.ts:1103-1113`, `server.ts:248-280`             |
| CLI/TUI Worker                                                                                                | Main process renders TUI, worker runs `Server.App().fetch()` via in-process RPC                                                                                                    | `packages/nikcli/src/cli/cmd/tui/thread.ts` (297) + `worker.ts` (188)             |
| Storage                                                                                                       | Key-path JSON store (`a/b/c.json`) with 5 s TTL write-through cache                                                                                                                | `packages/nikcli/src/storage/storage.ts`                                          |
| Bus                                                                                                           | Per-instance pub/sub with wildcard `*` subscriptions                                                                                                                               | `packages/nikcli/src/bus/index.ts`                                                |

---

## 3. Items by theme

### A — First-run experience ("Hello" moment)

| #   | Item                                                                                                            | Pri | Effort |
| --- | --------------------------------------------------------------------------------------------------------------- | --- | ------ |
| A1  | "Try without account" mode — surface OpenRouter's `:free` models to first-time users (no signup needed).        | P0  | M      |
| A2  | Pre-onboarding 30-second value preview — concrete examples (not just feature bullets) before the user signs up. | P0  | M      |
| A3  | Welcome step skip path — existing users go straight to `DialogLogin`, not the wizard.                           | P0  | S      |
| A4  | "What now?" first-session prompt — 3 clickable chips above the prompt after onboarding.                         | P0  | M      |
| A5  | Empty state for no-sessions home — one rotating example line above the prompt.                                  | P1  | S      |
| A6  | "Take a tour" overlay — opt-in 6-step interactive tour via `/tour` and help.                                    | P1  | M      |
| A7  | Restore Tips for first-time users — flip the default in `home.tsx:38-42` (currently `false`).                   | P0  | S      |

### B — Help, discoverability, the `?` problem

| #   | Item                                                                                                   | Pri | Effort |
| --- | ------------------------------------------------------------------------------------------------------ | --- | ------ |
| B1  | Rebuild `DialogHelp` (39 lines → real help: search, categories, current-context shortcuts, docs link). | P0  | M      |
| B2  | `?` any-time shortcut (outside the prompt) opens help. Currently palette-only.                         | P0  | S      |
| B3  | Context-aware palette ("what would I do now?" preset per state).                                       | P1  | M      |
| B4  | Cheat sheet in README (30 lines, 5 commands, 1 TUI shortcut).                                          | P0  | S      |
| B5  | "Examples:" section in every `--help` (run, auth, agent, etc.).                                        | P1  | M      |
| B6  | Footer hint "..." expansion when terminal too narrow.                                                  | P2  | S      |
| B7  | Keybind-fail toast ("shift+tab only works in the prompt").                                             | P2  | S      |
| B8  | `/help` opens the new interactive tour, not the empty stub.                                            | P0  | S      |

### C — Error messages and recovery

| #   | Item                                                                                       | Pri | Effort |
| --- | ------------------------------------------------------------------------------------------ | --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Centralized `UserFacingError` (title, what happened, what to try, docs link).              | P0  | M      |
| C2  | 401 / expired token → inline "Reconnect provider?" prompt (not raw `MessageAbortedError`). | P0  | M      |
| C3  | 429 rate-limit toast with countdown.                                                       | P1  | S      |
| C4  | Pre-flight context-overflow prompt ("87% full — `/compact` or continue?").                 | P1  | M      |
| C5  | Permission "Always allow" preview — expand matched `patterns` and last hits.               | P1  | S      |
| C6  | `learnMoreUrl` on every error in `util/error.ts` and `server/error.ts`.                    | P2  | M      |
| C7  | Surface "what now" command at the bottom of every install/upgrade failure.                 | P1  | S      |
| C8  | Provider connection test on save (1-token ping, fail fast with clear message).             | P0  | M      | **DONE** (client-side: after `sync.refreshProviders()`, verify the provider is in `provider_next.connected`; if not, show error toast and stay on prompt). |

### D — Onboarding wizard polish

| #   | Item                                                                                           | Pri | Effort |
| --- | ---------------------------------------------------------------------------------------------- | --- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| D1  | "Skip filesystem step" — informational only; link from Settings instead.                       | P1  | S      |
| D2  | Step 5: "Test your setup" — run one `echo` round-trip after Connect.                           | P0  | M      | **DONE** (added 5th step in `dialog-onboarding.tsx` with live status badge from `sync.data.provider_next.connected`). |
| D3  | Provider recommendation engine — "If you have Claude Max, pick Anthropic" with one-click copy. | P1  | M      |
| D4  | `/onboarding` slash to replay the wizard.                                                      | P2  | S      |
| D5  | "Forgot password" recovery in `DialogLogin`.                                                   | P1  | M      |
| D6  | Explicit telemetry opt-in step (default off + privacy link).                                   | P1  | S      |
| D7  | Extract onboarding strings to `onboarding.copy.ts` for localization.                           | P2  | M      |

### E — Command palette and shortcuts

| #   | Item                                                                                                                     | Pri | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --- | ------ |
| E1  | Show top 5 frecent commands by default (already have `FrecencyProvider`).                                                | P0  | S      |
| E2  | Slash-command inline help (name, description, keybind) when typing `/`.                                                  | P0  | M      |
| E3  | `hidden: true` → `palette: "advanced"` with an "Advanced" toggle.                                                        | P1  | S      |
| E4  | In-app custom keybind editor (`/keys`).                                                                                  | P1  | M      |
| E5  | `keybindings` → `keymappings` rename with migration helper (E7-B already specced in `specs/integration-master-plan.md`). | P1  | S      |
| E6  | Type-to-filter in `DialogModel`/`Agent`/`Theme`/`Mcp` — visible search input everywhere.                                 | P0  | M      |
| E7  | `Esc Esc` global abort (currently no abort keybind).                                                                     | P1  | S      |
| E8  | Vim-mode toggle in prompt (`/vim` and config flag).                                                                      | P2  | M      |

### F — First session, model, agent

| #   | Item                                                                                      | Pri | Effort |
| --- | ----------------------------------------------------------------------------------------- | --- | ------ |
| F1  | "Pick a starter agent" right after onboarding (Coding / Writing / Both → 1 of 3).         | P0  | M      |
| F2  | First-message cost estimate shown before Enter on long inputs.                            | P0  | M      |
| F3  | Model comparison labels (fast / cheap / best) + one-line description.                     | P1  | M      |
| F4  | Agent prompt preview (first 5 lines) on selection.                                        | P2  | S      |
| F5  | Variant picker default "max" for new users with a "use faster" hint.                      | P2  | S      |
| F6  | First-message templates (`/explain <file>`, `/fix <test>`) as chips for first-time users. | P0  | M      |

### G — Sessions and history

| #   | Item                                                                       | Pri | Effort |
| --- | -------------------------------------------------------------------------- | --- | ------ |
| G1  | Session sidebar default-open on first visit.                               | P0  | S      |
| G2  | Inline click-to-rename on session title.                                   | P1  | S      |
| G3  | Body search across sessions (`/search foo`).                               | P1  | M      |
| G4  | "Share / Copy" button in the session header.                               | P1  | S      |
| G5  | "Continue where you left off" banner on home when a recent session exists. | P0  | S      |
| G6  | Toast at 50/100/200 messages suggesting `/compact`.                        | P2  | S      |
| G7  | Empty state for sidebar ("No sessions yet — type a message to start.").    | P1  | S      |

### H — Documentation and discoverability (out-of-app)

| #   | Item                                                                                      | Pri | Effort |
| --- | ----------------------------------------------------------------------------------------- | --- | ------ |
| H1  | `nikcli quickstart` — 10-line interactive walkthrough (clack prompts).                    | P0  | M      |
| H2  | `nikcli doctor` — diagnose: missing provider, low disk, old version, broken PATH, no TTY. | P0  | M      |
| H3  | `nikcli feedback` — open pre-filled GitHub issue (config + last session, no secrets).     | P1  | S      |
| H4  | README quickstart section (5 commands, 1 screenshot, "next: docs").                       | P0  | S      |
| H5  | `nikcli examples` — clone a known-good example repo and open it.                          | P1  | M      |
| H6  | Install matrix in README (table for npm/bun/brew/curl, one line per platform).            | P0  | S      |
| H7  | First-install banner: "Welcome — first time? Run `/tour`".                                | P0  | S      |
| H8  | `nikcli --version --upgrade-check` (non-mutating).                                        | P2  | S      |

### I — Status, progress, feedback

| #   | Item                                                                     | Pri | Effort |
| --- | ------------------------------------------------------------------------ | --- | ------ |
| I1  | Persistent status bar (model, context %, current cost, background jobs). | P1  | M      |
| I2  | Long-task progress (Brain: sessions reviewed + ETA).                     | P1  | S      |
| I3  | Streaming running cost in the message corner.                            | P2  | M      |
| I4  | "What just happened" history in `/status` (last 5 events).               | P2  | S      |
| I5  | Toast / sound / Brain dedup — pick one channel per event.                | P1  | S      |
| I6  | `bg_pulse` toggle in the footer (config exists, no UI).                  | P2  | S      |

### J — Plugins, MCPs, power surfaces

| #   | Item                                                           | Pri | Effort |
| --- | -------------------------------------------------------------- | --- | ------ |
| J1  | `/plugin install <name>` from inside TUI with catalog browser. | P1  | M      |
| J2  | MCP "test connection" / ping button.                           | P1  | S      |
| J3  | Skill preview (description + first 3 lines) on hover/select.   | P2  | S      |
| J4  | Routine editor for user-owned routines (currently read-only).  | P2  | M      |
| J5  | Plugin error reporting (plugin name, version, "report" link).  | P1  | S      |

### K — Polish, accessibility, terminals

| #   | Item                                                                  | Pri | Effort |
| --- | --------------------------------------------------------------------- | --- | ------ |
| K1  | True color / 256-color fallback audit.                                | P1  | S      |
| K2  | Minimum-terminal-size guard (60×20 → "please resize" overlay).        | P0  | S      |
| K3  | Mouse-disabled fallback (no clickable regions in footer hints).       | P2  | S      |
| K4  | Narrow-terminal mode (< 80 cols: hide logo, shrink prompt).           | P1  | S      |
| K5  | `NO_COLOR` audit on every `UI.Style.*` usage.                         | P1  | S      |
| K6  | Color-blind safe built-in themes.                                     | P2  | M      |
| K7  | Respect `prefers-reduced-motion` for bg-pulse / spinners / streaming. | P2  | S      |
| K8  | `Locale.pluralize` for every count.                                   | P2  | S      |

### L — Performance and feel

| #   | Item                                                                    | Pri | Effort |
| --- | ----------------------------------------------------------------------- | --- | ------ |
| L1  | First-paint budget < 300 ms (currently hidden behind `StartupLoading`). | P1  | M      |
| L2  | Memoize long-session list rerenders (1000+ messages).                   | P2  | M      |
| L3  | No-flash theme switch.                                                  | P2  | S      |
| L4  | Lazy-load Brain, MCP catalog, plugin routes.                            | P1  | M      |
| L5  | Heap-snapshot button promoted to `/status`.                             | P3  | S      |

### M — Real bugs found during the audit (ship ASAP regardless of theme)

These are not UX improvements — they are user-visible defects discovered while writing this spec. Each is independently fixable and high-leverage.

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pri    | Effort |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| M1  | **Stale OAuth URL.** `src/auth/index.ts:310`, `src/account/url.ts:7`, `src/account/index.ts:29` hardcode `https://nikcli.mintlify.app/...`. Every other reference in the codebase uses `nikcli.store` (e.g. `installation/index.ts:153`, `server/server.ts:1040`, `provider/provider.ts:1078`). The `mintlify.app` host is a docs-mirror that was never the auth origin. Result: OAuth refresh for the bundled `nikcli` provider silently fails on every new login. | **P0** | S      |
| M2  | **Wrong security contact.** `SECURITY.md:41` escalates to `security@anoma.ly`. The repo is `nikomatt69/nikcli`; the org does not own that address. Replace with a real escalation address or point only to the GitHub Advisory tab.                                                                                                                                                                                                                                 | **P0** | S      |
| M3  | **`process.exit()` in `finally`.** `src/index.ts:182` calls `process.exit()` unconditionally in the `finally` block, including on success. This prevents callers and wrappers from inspecting the exit state and can break piped usage.                                                                                                                                                                                                                             | P1     | S      |
| M4  | **Silent cache wipe on `CACHE_VERSION` bump.** `src/global/index.ts:90-111` reads `CACHE_VERSION = "14"` and recursively `rm`s the entire cache dir on mismatch. New versions silently invalidate the user's `~/.nikcli/cache` with no log. At minimum, log the wipe; better: keep one version back.                                                                                                                                                                | P1     | S      |
| M5  | **Catch-all marketing-site proxy.** `src/server/server.ts:1037-1040` routes every unmatched path to `https://app.nikcli.store`. This is convenient for embedding the Web UI but means a typo in a user-typed URL silently fetches the marketing site. Make this an opt-in `NIKCLI_EMBED_WEB=1` flag with an explicit no-match 404.                                                                                                                                  | P1     | S      |
| M6  | **`autoupdate` default is implicit from `undefined`.** `src/cli/upgrade.ts:44` short-circuits on `config.autoupdate === false` _and_ on the env flag, but if `config.autoupdate` is _undefined_ (older config files), it falls through and runs. Make the default `true` explicit, not implicit-from-undefined. (The schema field is **not** dead — it _is_ read at `upgrade.ts:44`.)                                                                               | P2     | S      |
| M7  | **`$schema` is rewritten on every config load.** `src/config/config.ts:1724-1726` mutates the parsed config to inject `$schema`, then rewrites the original file with that line prepended. Repeated runs churn the file's line count. Make this one-shot per file (check if the line already exists).                                                                                                                                                               | P2     | S      |
| M8  | **TUI plugin lookup order mismatches docs.** The 6 OAuth plugins hardcoded at `src/plugin/index.ts:702-715` (Codex, Copilot, XAI, Cursor, Cloudflare Workers, Cloudflare AI Gateway) are not in the same order as `cli/cmd/auth.ts:384-392` (nikcli, anthropic, github-copilot, openai, google, openrouter, vercel). New users get a different priority in `auth login` than in plugin auto-load. Pick one canonical list and document it.                          | P2     | S      |

### N — Hidden power features (discoverability, not new functionality)

The codebase has several non-obvious capabilities that most users never find. These items are about surfacing them, not building them.

| #   | Item                                                                                                                                                                                                                                                             | Pri | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------ |
| N1  | **Notifications.** The `notify` plugin in `src/plugin/index.ts:1-620` already supports macOS native, Slack, Discord, with rate limiting, circuit breaking, and quiet hours. Surface a "Notifications" tab in `DialogSettings` with channel pickers.              | P1  | M      |
| N2  | **Connectors.** 9 built-in (Figma, Slack, GitHub, Lovable, Discord, Teams, GChat, Linear) at `src/config/config.ts:541-635`. No UI to browse or enable them. Add a `/connectors` slash and the command palette.                                                  | P1  | M      |
| N3  | **mDNS / LAN discovery.** `src/server/server.ts:1103-1113` already advertises `_http._tcp nikcli-{port}` via Bonjour. The mobile and remote companions consume it. Add a "Devices nearby" status indicator in `/status`.                                         | P2  | M      |
| N4  | **Free `nikcli` provider tier.** `src/provider/provider.ts:441` filters out non-free models if no key is set. Promote this on the home screen for users without any provider connected — they can try nikcli for free before being asked to enter a credit card. | P1  | S      |
| N5  | **Tailscale auth.** `src/server/server.ts:280` supports Tailscale identity headers as an alternative to Bearer tokens. Document and surface in the server-mode help.                                                                                             | P2  | S      |
| N6  | **Bundled provider list.** 20+ providers are pre-bundled (`src/provider/provider.ts:385-410`) — no `npm install` needed. Currently shown in `auth login` (8 in priority order) but the full list is hidden. Add a "Show all providers" toggle.                   | P1  | S      |
| N7  | **Project ID = first git commit.** `src/project/project.ts:153`. Show this in `/status` so users understand why two unrelated folders in the same repo share sessions.                                                                                           | P3  | S      |
| N8  | **OAuth plugin catalog.** The 6 hardcoded plugins (`src/plugin/index.ts:702-715`) are not user-discoverable. Add a "Plugins" dialog listing them with a one-line "what does this enable" description.                                                            | P1  | M      |

### O — TUI chat & session route (agent 2 deep-dive)

These items are about the **chat surface and session route** — the heart of the TUI — discovered by the agent 2 deep-dive. They are not a separate workstream; they slot into the same batches below.

| #   | Item                                                                                                                                                                                                                               | Pri    | Effort |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------- |
| O1  | **Silent prompt failure.** `src/cli/cmd/tui/component/prompt/index.tsx:1524` swallows submit errors with `.catch(() => {})`. A user hitting Enter during a bad state gets no feedback. Add a toast on the catch and log the error. | **P0** | S      |
| O2  | **No streaming / tokens-per-sec indicator during generation.** Users cannot tell whether the model is thinking, slow, or hung. Add a live tokens-per-sec line under the assistant message.                                         | P0     | M      | **DONE** (live rolling-window badge via `createStreamingSpeed` in `routes/session/index.tsx`). |
| O3  | **Fragile Ctrl+C interrupt chain.** The dialog stack + 2-strike-in-5s pattern is racy and confusing. Make first-Ctrl+C clearly abort the current request, second-Ctrl+C exit the TUI, both with toasts.                            | P1     | M      |
| O4  | **Missing confirmations on destructive session actions.** `session.unshare` (and friends) execute with no "Are you sure?". Add a confirm dialog for `unshare`, `delete`, and `fork-and-discard-parent`.                            | **P0** | S      |
| O5  | **Toast cap at 3.** A user can trigger 4+ events (Brain done, sound pulse, provider reconnect, permission asked) and only the last 3 are visible. Either raise the cap or dedupe per-event (overlaps with I5).                     | P1     | S      |
| O6  | **Theme picker: 100+ options with no preview.** `DialogThemeList` shows a flat list of 100+ themes. Add category grouping + a "live preview" pane that swaps the active theme on hover.                                            | P1     | M      |
| O7  | **Jargon-heavy subagent states.** "subtask.started" / "delegation.idle" / etc. are surfaced verbatim. Map them to user-readable strings ("Starting research subagent" / "Background task idle").                                   | P2     | S      |

---

## 4. Suggested sequencing

### Batch 1 — "New user can succeed" (P0 only, ~3 weeks)

A1, A2, A3, A4, A7, B1, B2, B4, B8, C1, C2, C8, D2, F1, F2, F6, G1, G5, H1, H2, H4, H6, H7, K2, E1, E2, E6, M1, M2, O1, O2, O4.

**Acceptance:** a new user can `curl install`, run `nikcli`, complete onboarding, get a useful response in their first session, and find `/help` from `?` — all without reading docs. `bun run typecheck` exits 0; `bun test` passes. M1 and M2 specifically: a new login to the `nikcli` provider succeeds, and a security report lands in the right inbox. O1/O2/O4 specifically: a submitted prompt never silently fails, the user always sees live generation progress, and no destructive session action runs without a confirm.

### Batch 2 — "Returning user can move faster" (P1, ~3 weeks)

A5, A6, B3, B5, C3, C4, C5, C7, D1, D3, D5, D6, E3, E4, E5, E7, F3, G2, G3, G4, G7, H3, H5, I1, I2, I5, J1, J2, J5, K1, K4, K5, L1, L4, M3, M4, M5, N1, N2, N4, N6, N8, O3, O5, O6.

### Batch 3 — "Power user is delighted" (P2, ongoing)

B6, B7, C6, D4, D7, E8, F4, F5, G6, H8, I3, I4, I6, J3, J4, K3, K6, K7, K8, L2, L3, L5, M6, M7, M8, N3, N5, N7, O7.

---

## 5. Non-goals (explicit)

- **No internal refactor** (Effect services, Hono→HttpApi, schema, ALS, `packages/server` extraction). All in `specs/integration-master-plan.md`.
- **No mobile-app UX** (Expo app at `packages/mobile/`).
- **No new features in core** — only how existing features are presented, ordered, explained.
- **No backward-incompatible config rename without a migration helper** (e.g. E5 needs a `keybindings`→`keymappings` shim).

---

## 6. Success metrics (with explicit user consent per D6)

- **Time to first useful response** — < 90 s with an existing API key, < 4 min if account setup needed.
- **`/help` open rate in the first session** — ≥ 1 per new user (proxy for "user knows where to look").
- **First-session depth** — median ≥ 3 prompts before quit.
- **7-day retention** — +20% over baseline.
- **"How do I…" support volume** — −30% per 100 active users.

---

## 7. Open questions to resolve before Batch 1 ships

1. **Telemetry stance:** silent, explicit opt-in (D6), or anonymous aggregated only? **Recommended:** explicit opt-in.
2. **Skip-account mode:** can a user run nikcli with no remote account at all? **Recommended:** yes (A1 enables it, using OpenRouter's `:free` models).
3. **Default model for A1's "try without account":** surface OpenRouter `:free` models and let the user pick one. No bundled local model. (Resolved: OpenRouter is the free path; "nikcli Zen" does not exist as a tier.)
4. **Plugin marketplace (J1):** do we have a public catalog today? If not, J1 is a feature, not UX. To verify in `src/plugin/install.ts` and `mcp-catalog.ts`.

---

## 8. Critical files to touch (grouped by likely change)

- **Onboarding / first run:** `cli/cmd/tui/component/dialog-onboarding.tsx`, `cli/cmd/tui/routes/home.tsx`, `cli/cmd/tui/component/dialog-login.tsx`
- **Help & palette:** `cli/cmd/tui/ui/dialog-help.tsx`, `cli/cmd/tui/component/dialog-command.tsx`, `cli/cmd/tui/app.tsx`, `cli/cmd/tui/ui/footer-hints.tsx`
- **Errors & recovery:** `src/index.ts`, `src/cli/error.ts`, `src/util/error.ts`, `src/server/error.ts`, `cli/cmd/tui/ui/toast.tsx`
- **Provider / model / agent / session dialogs:** `cli/cmd/tui/component/dialog-provider.tsx`, `dialog-model.tsx`, `dialog-agent.tsx`, `dialog-session-list.tsx`, `dialog-permission.tsx`
- **Prompt & autocomplete:** `cli/cmd/tui/component/prompt/index.tsx`, `autocomplete.tsx`, `cli/cmd/tui/component/tips.tsx`
- **Status / usage / theme / startup:** `dialog-status.tsx`, `dialog-usage.tsx`, `cli/cmd/tui/context/theme/`, `cli/cmd/tui/component/startup-loading.tsx`
- **CLI surface (new commands):** `src/index.ts`, `cli/cmd/upgrade.ts`, `cli/cmd/uninstall.ts`, `cli/cmd/auth.ts`, plus new files `cli/cmd/quickstart.ts`, `cli/cmd/doctor.ts`, `cli/cmd/feedback.ts`, `cli/cmd/examples.ts`
- **Config:** `src/config/tui-schema.ts` (E5, E8), `src/config/config.ts` (E5 migration shim)
- **Docs:** `packages/nikcli/README.md`, `packages/nikcli/docs/`
- **Bug-fix sites (theme M):** `src/auth/index.ts:310`, `src/account/url.ts:7`, `src/account/index.ts:29` (M1), `SECURITY.md:41` (M2), `src/index.ts:182` (M3), `src/global/index.ts:90-111` (M4), `src/server/server.ts:1037-1040` (M5)

---

## 9. Definition of done for this spec

- [x] All P0 items have a file:line citation (or the team fills in the gap).
- [ ] User signs off on §3 priorities and §4 sequencing.
- [ ] Implementation work begins on Batch 1.
