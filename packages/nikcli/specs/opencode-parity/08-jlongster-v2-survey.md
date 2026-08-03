# 08 — jlongster `v2` commit survey (2026-08-03)

Survey of every commit authored by **jlongster** on `anomalyco/opencode@v2` (~160 commits,
2026-03-25 → 2026-07-31), scored against nikcli's actual source. Companion to the earlier
survey recorded in memory (`project_jlongster_tui_prs`), which covered everything up to
**2026-06-06**: workspaces, session warping, project copies, the diff viewer. That verdict
stands — those are already nikcli's `warp` + `routes/changes/` and must not be re-ported.

This document covers the **new** material only: 2026-06-08 → 2026-07-31.

## Verdict

| opencode | PRs | nikcli | Action |
| --- | --- | --- | --- |
| Turn token usage diagnostics | #38398, #38514 | **Already present and larger**: `cli/cmd/tui/util/turn-usage.ts` (`f9f6022633`) groups steps into turns, compares cache across turn boundaries, and is paired with `provider/cache-diagnostics.ts` | Exposed in the UI (below) |
| DevTools debug bar | #38359 | Absent | Not ported — see rationale |
| Session export revamp | #35971 | Options dialog only; markdown-only output | **JSON format ported** |
| V2 theme system | #36950 → #39967 (~25 commits) | 100 flat V1 JSON themes in `cli/cmd/tui/context/theme/` | Deferred — see rationale |
| Batch event delivery | #39551 | `cli/cmd/tui/context/sdk.tsx` already batches, at 16 ms vs opencode's 10 ms | N/A |
| Ecosystem skill dirs (`.claude`, `.agents`) | #35956 | `skill/skill.ts:99` `EXTERNAL_DIRS` | N/A |
| Frontend logs over OTLP | #36152 | `observability/otlp.ts` + TUI observability feature-plugin | N/A |
| V2 formatter runtime | #39564, #39575 | Config surface already identical (`false \| true \| record{disabled,command,environment,extensions}`, `config.ts:1557`); the BOM half of #39564 is in `tool/edit.ts:118` and `tool/write.ts:66` | N/A |
| Simulation cluster | #34801 → #36306 | Ported: `ui.resize`, `ui.matches`, `ui.screenshot`, `llm.disconnect`, `toolCall` all in `packages/simulation/src/protocol` | N/A |
| Event stream extraction / connection logging | #38872, #35973 | `context/sdk.tsx` already tracks status/attempt/reconnect | N/A |
| Layer-node graph, tiered layers, Effect test wiring | #31531, #33937, … | opencode-internal | N/A — nikcli's Effect migration is deliberately partial |

## Applied

### `tui.turn_tokens` reachable from the UI

The per-turn table existed but could only be enabled by hand-editing `nikcli.json`. New
config-backed settings category **Diagnostics**
(`cli/cmd/tui/component/dialog-settings/diagnostics.tsx`), registered in the same file's
`SETTINGS_CATEGORIES` so it surfaces in the command palette.

Config-backed rather than KV-backed on purpose: the toggle changes what the *session view*
renders for every client of the project, so a per-terminal preference is the wrong scope.

This is the nikcli-native answer to opencode's debug bar. A 533-line overlay whose content is
runtime perf sampling plus three debug toggles buys little here — nikcli already has a settings
dialog with palette search, and the observability feature-plugin covers the runtime side.

**Still unreachable from any dialog** (config-file-only, same class of gap, not addressed here):
`tui.math`, `tui.bg_pulse`, `tui.diff_style`, `tui.mouse`, `tui.sound`, `tui.scroll_speed`.

### JSON session export

`formatTranscriptJson` in `cli/cmd/tui/util/transcript.ts`, selected by a `.json` filename in
the export dialog — an extension the dialog's placeholder has always advertised and never
honoured. Transcript options carry over with the same semantics as markdown: `thinking: false`
drops reasoning parts, `toolDetails: false` keeps the tool call as a bare record of the call but
never its input or output, `assistantMetadata: false` strips agent/model provenance.

opencode's `dialog-export-result` was **not** ported: it exists because opencode writes to a
random `tmpdir` path the user cannot guess. nikcli asks for the filename and writes to cwd, so
the dialog would add a step and inform nobody. The success toast now reports the full path and
the format instead.

## Deferred: V2 theme system

The largest item in the set and the only one with a real architectural case. opencode replaced
flat palettes with hue-derived semantic tokens, plus `v1-migrate.ts` so existing V1 themes keep
working, categorical hues for agent colors, a hovered state, syntax generated from the theme,
extraction into a standalone `@opencode/theme` package, and the resolved theme exposed to
plugins.

For nikcli the payoff would be *larger* than for opencode: TUI, desktop, mobile and web each
carry a separate token vocabulary today, and a `@nikcli-ai/theme` resolving to both terminal
RGBA and CSS custom properties would unify them. It is also a refactor touching every TUI
component. If only a slice is wanted, the cheap one is `expandTheme` plus the resolved theme
exposed to plugins (#39536, #39967).

## Verification

- `bun run typecheck` clean in `packages/nikcli` and `packages/simulation`.
- `packages/nikcli/test/tui/util/transcript-json.test.ts` — 7 tests over the JSON formatter,
  including that tool output cannot leak when `toolDetails` is off.
- `packages/simulation/test/settings-diagnostics.test.ts` — drives the **real** TUI headless:
  palette → Diagnostics → row reads OFF → toggle → `nikcli.json` contains
  `{"tui":{"turn_tokens":true}}` → reopened row reads ON.
  This test deliberately does **not** set `NIKCLI_DISABLE_PROJECT_CONFIG`, unlike the other
  drive tests: with it set the server never reads the project config back and the row stays OFF.
- `packages/simulation`: 14/14 pass, including both e2e drive tests.

## Note for the next survey

The 2026-06-06 survey and this one both initially scored *turn token diagnostics* as a gap. It
is not, and has not been since `f9f6022633`. Check `cli/cmd/tui/util/turn-usage.ts` before
concluding otherwise.
