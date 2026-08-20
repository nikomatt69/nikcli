---
name: browser-control
description: Autonomously control, inspect, test, and record real web pages through a background headless-browser daemon, producing screenshots, GIF, MP4, a manifest, and PR-ready Markdown. Use whenever the user asks to test, check, exercise, or verify a web UI, frontend flow, dashboard, or browser regression, including requests such as "testa la UI", "verifica questa pagina", "registra il flusso nel browser", or "includilo nella PR".
---

# Browser Control

Operate real, visible page state with `browser-control`. Never infer a UI outcome from server logs alone. Inside the nikcli monorepo, where the package binary is not installed globally, replace `browser-control` with `bun run --cwd packages/browser-control control --`.

Sessions run headlessly in a per-workspace background daemon that survives across separate CLI calls (auto-spawned on first use, self-terminating after 10 idle minutes) — start a session in one command, drive and inspect it across several more, then stop it.

## Handle Requests Autonomously

When the user asks to test a web UI, inspect the project to identify how to run it locally (dev server URL, port) and the acceptance criteria, then run the verification without asking for commands that are already discoverable. Translate the requested interactions into deterministic `wait`, `click`, `fill`, and `send` operations. Do not claim success unless a captured snapshot proves the expected result.

Restarted nikcli processes discover this skill through `.agents/skills/browser-control`. If the skill is not registered in the current workspace, install it once from the worktree root:

```bash
bun run --cwd packages/browser-control install-skill
```

## Run A Recorded Verification

```bash
browser-control start ui-check --url http://localhost:3000 --viewport 1280x800 --record
browser-control wait ui-check --text "Dashboard" --timeout 20000
browser-control click ui-check "#open-settings"
browser-control wait ui-check --selector "[data-testid=settings-panel]" --timeout 5000
browser-control start-recording ui-check
browser-control marker ui-check ready
browser-control fill ui-check "#name" "hello"
browser-control click ui-check "#save"
browser-control wait ui-check --text "Saved" --timeout 10000
browser-control marker ui-check verified
browser-control snapshot ui-check --out /tmp/ui-check.png --format png
browser-control stop-recording ui-check
browser-control stop ui-check
```

Use `wait` after every input instead of fixed sleeps: `--text VALUE` for visible text, `--selector SEL [--state visible|attached|hidden|detached]` for DOM presence, or `--idle` for network idle. Use `snapshot --format text` to read the page's accessibility tree when a screenshot alone won't prove the state (e.g. verifying an aria-live announcement or a form value).

Always `stop` named sessions when done, including after failures — `stop` keeps the session queryable (for the `--record` video, only readable after `stop`) until you `remove` it or the daemon's idle timeout reclaims it. Treat recordings and typed input as potentially sensitive (auth flows, pasted credentials).

## Produce PR Evidence

After stopping the session, fetch the video path if one was recorded and bundle it with the final screenshot:

```bash
browser-control bundle \
  --screenshot /tmp/ui-check.png \
  --video "$(browser-control videoPath ui-check 2>/dev/null)" \
  --out artifacts/browser/ui-check \
  --link-base artifacts/browser/ui-check \
  --result passed \
  --title "UI verification" \
  --summary "The tested interaction completed successfully."
```

The bundle contains `screenshot.png`, `demo.mp4`, `preview.gif`, `manifest.json`, and `pr.md`.

Use `pr.md` as the PR section; it embeds the GIF preview and links the full MP4. The bundle command also prints an absolute `file://` preview Markdown line — include that exact line in the final assistant response so nikcli can render the local preview inline, but never paste that `file://` URL into a pull request.

When the user explicitly requests PR evidence or the task is already operating on a pull request:

1. Write the bundle under a stable repository path such as `artifacts/browser/<check-name>`.
2. Inspect the screenshot, preview and manifest for secrets or sensitive account data before publishing.
3. Commit and push the safe generated evidence.
4. Use a public `--link-base` for the pushed artifact directory when available, then append the contents of `pr.md` to the existing PR description without discarding its current content.

If no pull request exists, leave `pr.md` ready and report its path instead of creating unrelated remote state.

If the test fails, still capture the final screenshot and video with `--result failed`, describe the observed failure accurately, and never report it as passed.

## Cleanup

`browser-control close-all` stops every session in the current workspace and shuts down the daemon immediately — use it once evidence has been captured and there's nothing left to inspect. Otherwise the daemon exits on its own after 10 minutes with no running sessions.
