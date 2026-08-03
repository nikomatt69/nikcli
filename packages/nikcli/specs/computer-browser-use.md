# Computer use and browser control

Status: **implemented** (reconciled 2026-08-03).

nikcli exposes two first-class tools to the WebGUI/desktop app, TUI, and agents:

- `browser_control` drives a **local headless Chromium** via `@nikcli-ai/browser-control` (Playwright).
- `computer` drives a **desktop session** via `@nikcli-ai/computer-use` (sandbox Linux desktop by default, optional host mode).

Both are enabled by default and can be disabled with:

```sh
NIKCLI_DISABLE_BROWSER_CONTROL_TOOL=1
NIKCLI_DISABLE_COMPUTER_TOOL=1
```

(`Flag.NIKCLI_EXPERIMENTAL_BROWSER_CONTROL_TOOL` / `NIKCLI_EXPERIMENTAL_COMPUTER_TOOL` are default-on unless those disable envs are set. The pre-rename `NIKCLI_DISABLE_BROWSER_TOOL` still opts out.)

Permission-gated: computer actions default to permission `ask`.

---

## Browser control — `@nikcli-ai/browser-control`

**Not** Browser Use Cloud. There is no `BROWSER_USE_API_KEY` / `browser-use-sdk` path in the current tree.

| Piece  | Location                                      |
| ------ | --------------------------------------------- |
| Tool   | `packages/nikcli/src/tool/browser-control.ts` |
| Engine | `packages/browser-control` (`playwright`)     |
| Skill  | `packages/browser-control/skills/`            |

### Actions

`start`, `goto`, `click`, `fill`, `hover`, `scroll`, `send`, `wait`, `snapshot`, `resize`, `list`, `info`, `stop`, `remove`, `restart`, `start_recording`, `marker`, `stop_recording`, `recording_data`, `video_path`, `close_all`.

Sessions are named (default: one per conversation). The agent plans selectors/waits itself; this is **not** an autonomous “run this NL task in the cloud” API.

Evidence workflow: screenshots, GIF/MP4, manifest, PR-ready markdown via the package CLI/skill.

---

## Computer — `@nikcli-ai/computer-use`

| Piece  | Location                                     |
| ------ | -------------------------------------------- |
| Tool   | `packages/nikcli/src/tool/computer.ts`       |
| Engine | `packages/computer-use`                      |
| Skill  | `packages/computer-use/skills/computer-use/` |

### Modes (`computer.mode` config)

| Mode                | Behavior                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `sandbox` (default) | Isolated Linux desktop in a container (Colima on macOS). No real-time takeover of the user machine. |
| `host`              | Drives the user’s real desktop. Opt-in only; needs Screen Recording + Accessibility on macOS.       |

### Actions

`screenshot`, `capabilities`, `screen_size`, `mouse_move`, `left_click`, `right_click`, `middle_click`, `double_click`, `left_click_drag`, `type`, `key`, `scroll`, `status`, `stop`.

Control loop: screenshot → decide → action → screenshot. Coordinates are screen pixels from top-left.

Sibling packages with the same control/evidence pattern:

- `@nikcli-ai/browser-control` — headless pages
- `@nikcli-ai/terminal-control` — PTY-backed TUI sessions
- `@nikcli-ai/computer-use` — desktop sessions

---

## Historical note

An earlier draft of this spec described **Browser Use Cloud SDK v3** (`browser-use-sdk`, `BROWSER_USE_API_KEY`, NL `run`/`keepAlive`). That product path was **not** shipped. The real implementation is local Playwright + the browser-control daemon/RPC package. Do not reintroduce Cloud-only docs without matching code.
