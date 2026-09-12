# EOT-00: Intermittent Never-Paints Startup

Status: proposed. Tier: 1. Phase: P0. Dependencies: none.
Owner: TUI host/renderer maintainers. [Roadmap](../ROADMAP.md).

This spec gates every other promotion in the program. It exists because the defect below was recorded only as
prose inside EOT-01's first slice, where nobody reading the prioritized table would see it, and because the
repro harness that entry claimed had landed did not exist in the repository.

## Problem and Evidence

On 2026-09-12 the compiled binary was observed to **intermittently never paint** — roughly one startup in three
to eight, reproduced repeatedly at the same load as runs that finished in 4.5-5.8s, so not contention.

A hung instance was sampled. Its last output before going silent is the terminal capability negotiation
`@opentui/core` performs at renderer creation: OSC 10/11 and OSC 4 colour queries, XTGETTCAP, the OSC 99
notification probe, the iTerm2 OSC 1337 feature query, the Kitty graphics query `ESC_Gi=31337`, and the OSC 66
text-sizing probes. Then nothing, for as long as it is left running, with the main thread parked in `kevent64`
— idle, waiting for an event, not spinning. The startup blocks on replies a terminal is supposed to send.

Two things that look like workarounds are not: `--print-logs` appears to fix it but only defeats the probe's
"has it painted" threshold, because the log text itself crosses it; and forcing `OPENTUI_GRAPHICS` /
`OPENTUI_NOTIFICATIONS` / `OTUI_PALETTE_IDLE_TIMEOUT_MS` still hangs, with the same query block as the last output.

Two structural observations:

- `createCliRenderer` is awaited with no deadline (`packages/tui/src/app.tsx:189`). The adjacent theme probe
  already has one (`waitForThemeMode?.(1000)`, `:198`) and the palette query is deliberately fire-and-forget
  (`:197`). The capability negotiation inside `createCliRenderer` has neither.
- The probe cannot count the failure. `packages/nikcli/script/tui-startup.ts:208` raises `never painted`, so a
  single wedged sample aborts the entire 30-run warm collection rather than being recorded as an outcome.

## Scope and Non-Goals

In scope: a deterministic reproduction, a `hangRate` metric, a deadline and conservative fallback for terminal
capability negotiation, and — if the cause is upstream — a pinned patch of `@opentui/core@0.5.11` through the
existing `patches/` mechanism guarded by `script/check-patched-deps.ts`.

Out of scope: the 4.8-5.2s firstPaint median and 500-620MB RSS (EOT-08 and EOT-01 own those), any renderer
rewrite, an OpenTUI fork, and any change to renderer worker/thread defaults.

## Design and Requirements

1. **Count it before fixing it.** The probe records `{painted, hung, hangRate}` per run and never throws on a
   wedged sample. A run that hangs is data, not an aborted collection. `hangRate` appears in the JSON that
   `bench:startup` emits and in the `BASELINE` comparison.
2. **Reproduce on demand.** A harness spawns the compiled binary under a PTY that deliberately never answers
   capability queries, and asserts the startup still paints. This is the smallest deterministic form of the
   defect and does not depend on catching the intermittent case.
3. **Deadline the negotiation.** Terminal capability negotiation gets a bounded wait. On expiry the renderer
   starts with a conservative capability set (no Kitty graphics, no OSC 99 notifications, no OSC 66 text
   sizing) rather than waiting for a reply that is not coming. A capability that could not be negotiated is
   reported as absent, never assumed present.
4. **Do not paper over it.** Raising the probe's paint threshold, enabling `--print-logs`, or averaging over
   the samples that did paint are all forbidden as resolutions. Each certifies a startup that sometimes does
   not happen.
5. **Fix upstream if it is upstream.** If the block is inside `@opentui/core`, land a patch under `patches/`
   and keep `script/check-patched-deps.ts` green; record the upstream issue so the patch has a removal criterion.

## Release Gate

- `hangRate == 0` over **200 consecutive compiled starts** across a PTY matrix of at least: `xterm-256color`,
  inside `tmux`, Ghostty, and an unknown/minimal `TERM`. Raw per-run outcomes attached to the PR.
- The non-answering-PTY harness from requirement 2 passes, and fails if the deadline is removed.
- `bench:startup` emits `hangRate` and a wedged sample no longer aborts the collection.
- EOT-01 candidate budgets may be ratified only after this gate passes.

## Rollback

The deadline is a bounded wait around existing negotiation, so rollback restores the unbounded await and the
recorded `hangRate` immediately shows the regression. The capability fallback must not be rolled back
separately: a terminal reported as capable without a reply is the defect, not the mitigation.
