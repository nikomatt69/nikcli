# OpenTUI 0.1.95 → 0.4.5 upgrade

Done 2026-08-01. The whole monorepo now pins `@opentui/core` / `@opentui/solid`
at **0.4.5** (previously 0.1.95, and `packages/plugin` had drifted to 0.1.91).

## The blocker, and what it actually was

A straight version bump made `packages/simulation` — which drives the real TUI
headless — fail hard:

| Symptom | Where |
| --- | --- |
| Streamed assistant replies never reach the screen; the driver's `ui.matches("…")` never becomes true | `test/e2e.test.ts` |
| `Cannot create CliRenderer: stdin is already used by another CliRenderer` | the 3 tests in `test/plugin-hot-reload.test.ts` |

Bisecting `test/e2e.test.ts` put the break at exactly **0.1.97** (0.1.96 is clean),
and every later version reproduced it. The first symptom looks like a rendering or
reactivity regression and the second like a teardown leak, but both come from **one**
cause.

### Root cause: two physical copies of `@opentui/core`

`@opentui/solid`'s render entry point is:

```ts
const render = async (node, rendererOrConfig = {}) => {
  const renderer = rendererOrConfig instanceof CliRenderer
    ? rendererOrConfig
    : await createCliRenderer({ ...rendererOrConfig, /* … */ })
  engine.attach(renderer)
  mountSolidRoot(renderer, node)
}
```

`app.tsx` already passed its renderer as the second argument, so this should have
been a no-op reuse. But bun had resolved **two distinct store entries** for the same
version:

```
node_modules/.bun/@opentui+core@0.4.5+2240c214a0f33214   ← packages/nikcli, plugin, webrenderer
node_modules/.bun/@opentui+core@0.4.5+64015adf11caec84   ← packages/simulation, root
```

Identical contents, different module identity. In drive mode the renderer was built
by `packages/simulation` (entry `+64015…`) while `@opentui/solid` resolved
`CliRenderer` from `+2240c…`, so `instanceof` was `false`, Solid silently built a
**second** renderer and mounted the UI into *that* one. Hence: the driver watches
renderer A, the app renders into renderer B, and streamed output never shows up.
The `stdin` error is the same bug — 0.4.x simply added a guard
(`rendererTracker.streamOwners`) that turns the second construction into a loud
failure instead of a silent one. That guard is why the bug became visible at 0.4.x;
it was already corrupting drive-mode rendering from 0.1.97 on.

Aligning peer dependencies did not collapse the two store entries (the hash covers
the resolution chain, not just resolved versions), so the fix is in code.

### The fix

`packages/simulation` no longer constructs renderers from its own `@opentui/core`.
It accepts the host's constructors and uses them:

- `Drive.create(options, host?)` and `SimulationRenderer.create(…, host?)` take an
  optional `HostRuntime` (`createCliRenderer`, `createTestRenderer`); when absent
  they fall back to this package's own imports, so the package still works
  standalone in its own tests.
- `app.tsx` passes `{ createCliRenderer, createTestRenderer }` from nikcli's own
  `@opentui/core` / `@opentui/core/testing` when entering drive mode.

This guarantees the renderer handed to `render(node, renderer)` is an instance of
the same `CliRenderer` class `@opentui/solid` checks against, regardless of how bun
lays out `node_modules`.

**Rule of thumb:** any package loaded *inside* the TUI process must never construct
OpenTUI objects whose class identity the host will test. Take the constructor from
the host.

## Other changes required

- 4 type errors from tightened JSX typings: `description` on `DialogPrompt` is
  `() => JSX.Element`, so `dialog-provider.tsx` had to pass a thunk rather than a
  JSX element (previously accepted because Solid's `JSX.Element` union used to
  include functions); and `Diagnostic.message` is now `string | MarkupContent`,
  normalized through the existing `LSP.Diagnostic.message` helper.
- `Dockerfile.serve` pins `@opentui/solid@0.4.5` in its extra `bun install`.
- `packages/bench-tui/node_modules/@opentui` was a stale real directory (0.1.95)
  rather than a symlink into the bun store; removing it let the install take.

## Verification

| Check | Result |
| --- | --- |
| `bun run typecheck --force` (monorepo) | 32/32, 0 cached |
| `packages/simulation` `bun test` | 13/13, 63s (was 9 pass / 4 fail, 278s) |
| `packages/nikcli` `bun test test/tui test/tool/opentui-tolerance.test.ts` | 312/312 |

The ~4.7x suite slowdown seen before the fix was an artifact of the failing tests
burning their 120s timeouts, not a performance regression in OpenTUI.

## Notes for the next bump

- 0.4.5 drops `jimp` and `yoga-layout` as dependencies — image decoding and the
  layout engine moved native. `test/tui/background-image.test.ts` and
  `background-renderable.test.tsx` cover that path and pass.
- `bun run typecheck` from the root can report a clean 32/32 entirely from turbo
  cache (`FULL TURBO`) without ever running `tsc`. Check the `Cached:` line, or
  pass `--force`, before trusting a green result.
- In `packages/nikcli` the correct compiler is the local
  `node_modules/.bin/tsc` (`@typescript/native` 7.0.2), not the root one.
