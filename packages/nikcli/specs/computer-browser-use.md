# Computer use and browser use

nikcli exposes two first-class tools to both the WebGUI/desktop app and the TUI:

- `browser` runs persistent Browser Use Cloud SDK v3 sessions.
- `computer` captures the local desktop and sends native mouse/keyboard input.

Both are enabled by default, permission-gated, and can be disabled with
`NIKCLI_DISABLE_BROWSER_TOOL` or `NIKCLI_DISABLE_COMPUTER_TOOL`.

## Browser Use SDK v3

The browser tool uses the official `browser-use-sdk` TypeScript package. Set:

```sh
export BROWSER_USE_API_KEY=bu_...
```

Each nikcli conversation owns one Browser Use session. `action=run` dispatches a
natural-language task with `keepAlive: true`; subsequent runs reuse the same
browser, cookies, tabs, and page state. The tool streams activity messages into
tool metadata, including `liveUrl`, `summary`, and `screenshotUrl`, so desktop
can embed the live browser and the TUI can report the current action.

Browser Use integration skills, scheduled tasks, and temporary email are
disabled. Optional profile IDs are accepted only when the user intentionally
wants persisted authentication.

Actions: `run`, `status`, `messages`, `stop`.

## Native computer driver

Computer use stays local and does not use Browser Use or another desktop app.
The driver implements screenshots and synthetic input using platform facilities:

- macOS: `screencapture` and System Events; optional `cliclick` for move/drag.
- Linux/X11: `xdotool` plus `scrot`, ImageMagick, or GNOME Screenshot.
- Windows: PowerShell, .NET, and User32.

Actions: `screenshot`, `capabilities`, `screen_size`, `mouse_move`,
`left_click`, `right_click`, `middle_click`, `double_click`,
`left_click_drag`, `type`, `key`, and `scroll`.

The expected control loop is screenshot, one action, then a fresh screenshot.
Coordinates are screen pixels. Computer actions default to permission `ask`.
