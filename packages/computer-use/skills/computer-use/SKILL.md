---
name: computer-use
description: Autonomously control, inspect, test, and record real desktop sessions through a background per-workspace daemon, producing screenshots, GIF, MP4, a manifest, and PR-ready Markdown. Use whenever the user asks to test, check, exercise, or verify a desktop application, GUI workflow, or "computer use" automation — including requests like "testa la GUI", "apri le impostazioni", "verifica il flusso desktop", "registra il desktop", or "includilo nella PR".
---

# Computer Use

Operate the visible desktop with `computer-use`. Never infer a desktop outcome from logs alone. Inside the nikcli monorepo, where the package binary is not installed globally, replace `computer-use` with `bun run --cwd packages/computer-use control --`.

## Handle Requests Autonomously

When the user asks to test or automate a desktop application, identify the real launch command and acceptance criteria, then run the recorded verification without asking for commands that are already discoverable. Translate the requested interactions into deterministic `wait`, `click`, `type`, and `key` operations. Do not claim success unless a captured screenshot proves the expected result.

Restarted nikcli processes discover this skill through `.agents/skills/computer-use`. If the skill is not registered in the current workspace, install it once from the worktree root:

```bash
bun run --cwd packages/computer-use install-skill
```

## Run A Recorded Verification

```bash
computer-use start ui-check --mode sandbox --width 1280 --height 800
computer-use wait ui-check --stable --ms 1000 --timeout 15000
computer-use click ui-check 320 200
computer-use start-recording ui-check --fps 4
computer-use marker ui-check ready
computer-use type ui-check "hello world"
computer-use key ui-check Return
computer-use wait ui-check --stable --ms 1500 --timeout 10000
computer-use marker ui-check verified
computer-use screenshot ui-check --out /tmp/ui-check.png
computer-use stop-recording ui-check
computer-use stop ui-check
```

Use `wait` after every input instead of fixed sleeps: `--stable` (with optional `--ms`) resolves once the screen stops changing, `--timeout MS` waits a fixed window. There is no DOM on a desktop, so the only honest "wait" is "the screen stopped changing" or "a fixed timeout elapsed".

Always `stop` named sessions when done, including after failures — `stop` keeps the session queryable (e.g. the sandbox `liveUrl` for a noVNC preview) until you `remove` it or the daemon's idle timeout reclaims it. Treat screenshots and typed input as potentially sensitive (auth flows, pasted credentials).

## Produce PR Evidence

After stopping the session, bundle the final screenshot and recording:

```bash
computer-use bundle \
  --screenshot /tmp/ui-check.png \
  --recording "$(computer-use recording-data ui-check 2>/dev/null || echo)" \
  --out artifacts/computer/ui-check \
  --link-base artifacts/computer/ui-check \
  --result passed \
  --title "Computer verification" \
  --summary "The tested desktop interaction completed successfully."
```

The bundle contains `screenshot.png`, `demo.mp4` (assembled from the recorder's periodic samples), `preview.gif`, `manifest.json`, and `pr.md`. When the recording has no samples (markers-only mode), no video is produced.

Use `pr.md` as the PR section; it embeds the GIF preview and links the full MP4. The bundle command also prints an absolute `file://` preview Markdown line — include that exact line in the final assistant response so nikcli can render the local preview inline, but never paste that `file://` URL into a pull request.

When the user explicitly requests PR evidence or the task is already operating on a pull request:

1. Write the bundle under a stable repository path such as `artifacts/computer/<check-name>`.
2. Inspect the screenshot, preview and manifest for secrets or sensitive account data before publishing.
3. Commit and push the safe generated evidence.
4. Use a public `--link-base` for the pushed artifact directory when available, then append the contents of `pr.md` to the existing PR description without discarding its current content.

If no pull request exists, leave `pr.md` ready and report its path instead of creating unrelated remote state.

If the test fails, still capture the final screenshot and video with `--result failed`, describe the observed failure accurately, and never report it as passed.

## Modes

- `sandbox` (default) — drives an isolated Linux desktop in a Docker container; the host screen is never touched. The container is created lazily on first action and exposes a noVNC `liveUrl` for an optional live preview. Needs a reachable container runtime (`docker`, or set `NIKCLI_COMPUTER_RUNTIME`). On macOS start it with colima (already a lightweight Linux VM):
  ```bash
  colima start --cpu 4 --memory 6 --disk 30
  ```
- `host` — drives the user's real desktop in real time (screencapture + System Events on macOS, scrot/import/gnome-screenshot + xdotool on Linux, PowerShell + SendKeys on Windows). Only opt-in.

## Cleanup

`computer-use close-all` stops every session in the current workspace and shuts down the daemon immediately — use it once evidence has been captured and there's nothing left to inspect. Otherwise the daemon exits on its own after 10 minutes with no running sessions.
