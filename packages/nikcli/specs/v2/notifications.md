# TUI Notifications Default

Problem:

- v1 defaults `attention.enabled` to `false`
- users can opt in with `attention.enabled = true`
- v2 should make core TUI notifications a default behavior

## v2 Target

Flip `attention.enabled` to `true` by default in v2.

Keep `attention.enabled = false` as the explicit opt-out.

## Status: done (2026-06-12)

The v1 `attention.enabled` config became `tui.sound` along the way; the
default-flip was applied there. `app.tsx` now gates the
`permission.asked` / `session.idle` attention pulses with
`tuiCfg?.sound === false` (opt-out) instead of `!tuiCfg?.sound` (opt-in),
and the `sound` schema descriptions in `config/tui-schema.ts` and
`config/config.ts` document `default: true`. Pulses still fire only when
the terminal is unfocused (`attention.focus() !== "focused"`).
