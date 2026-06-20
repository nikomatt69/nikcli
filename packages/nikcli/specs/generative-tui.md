# Generative TUI — real-time, streaming visualizations

nikcli's answer to [vercel-labs/json-render](https://github.com/vercel-labs/json-render),
built on **AI SDK + OpenTUI**. The model emits a visualization spec; nikcli renders it
**incrementally, as it streams**, so the interface assembles itself in real time.

## The three json-render layers (and where they live)

This is a faithful port of [json-render](https://json-render.dev/docs)'s three core
abstractions — **Catalog**, **Registry/Renderer**, **SpecStream compiler** — onto
OpenTUI. Where json-render targets the DOM via `@json-render/solid`, nikcli targets
the terminal via `@opentui/solid`, but the API shapes line up one-to-one.

| json-render concept                                                                                                                        | nikcli implementation                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Catalog** — `defineCatalog(schema, config)` → a `Catalog` with `prompt()`, `validate()`, `zodSchema()`, `jsonSchema()`, `componentNames` | `src/tool/opentui.ts` — 25 Effect-Schema components (text, table, tree, charts, gauges, timeline, card, list, accordion, compare, sparkline_row…). The `VizCatalog` object exposes the exact same surface: `VizCatalog.prompt()`, `.validate(spec)`, `.zodSchema()`, `.jsonSchema()`, `.componentNames`, `.decodeComponent`. Also exports `VizComponentZod`, `VizSpecZod`, `VIZ_COMPONENT_TYPES`, `decodeVizComponent`.                |
| **Registry / Renderer** — `defineRegistry` / `createRenderer(catalog, components)` / `<Renderer spec registry loading />`                  | `src/cli/cmd/tui/component/dialog-opentui-viz.tsx` — `VizRegistry` maps each catalog `type` → an OpenTUI Solid component; `defaultVizRegistry` covers all 25; `<Renderer spec registry loading />` and `createVizRenderer(overrides)` walk a spec through a (swappable) registry, threaded via context so nested `section`/`grid` inherit it. `ComponentRenderer` is the per-component dispatcher (registry lookup + `ErrorBoundary`). |
| **SpecStream compiler** — `createSpecStreamCompiler()` with `push`, `getResult`, `getPatches`, `reset`                                     | `src/cli/cmd/tui/util/spec-stream.ts` — `createSpecStreamCompiler` exposes `push`/`pushObject`/`finalize`/`getResult`/`getPatches`/`reset`/`snapshot` and emits RFC-6902-flavored `VizPatch[]`.                                                                                                                                                                                                                                        |

## Crash-safety (rendering half-formed specs)

Streaming feeds the renderers components that are schema-valid but may be
cross-field-inconsistent mid-stream (a `table` whose rows are shorter than its
headers, an unterminated markdown code fence, etc.). `ComponentRenderer` wraps
its `Switch` in a per-component `ErrorBoundary`, so a throwing renderer degrades
to a muted `⚠ <type> unavailable` placeholder instead of bubbling up to the
app-level boundary and crashing the whole TUI. The dialog renders the active tab
through `<Show keyed>` so a latched boundary resets when you switch tabs. The
live inline preview re-creates rows per snapshot, so each gets a fresh boundary.

## Input tolerance (why the tool rarely hard-fails)

Models differ wildly in how well they hit a strict 20-variant union. Some (e.g.
MiniMax) wrap every array element in an `item` key — `components: [{ item: {…} }]`
— which used to reject the entire tool call. The tool is now forgiving:

- The `components` element schema is `Union([VisualizationComponent, looseObject])`,
  so the boundary never rejects a whole call over one odd component. Good models
  still match the structured branches (and keep their descriptions).
- `decodeVizComponent` runs `deepUnwrap` first, stripping single-key wrappers
  (`item`/`component`/`element`/`node`/`child`) before validating.
- `execute` calls `normalizeVizComponents`, keeping only render-safe components
  and never throwing — a fully-unrenderable call returns a guiding message
  instead of an error. The same `decodeVizComponent` powers the live stream, so
  wrapped components render incrementally too.

## The streaming engine — `spec-stream.ts`

Two ideas make half-finished model output safe to render:

1. **Tolerant repair** — `parsePartialJson` closes dangling strings, brackets,
   trailing commas and half-written keys, so a truncated stream still yields a
   structurally valid object.
2. **Catalog validation** — each candidate component must `decodeVizComponent`
   (the same catalog the model is constrained to). A component renders only once
   it is complete; the trailing in-flight component simply waits. The compiler
   bumps `version` only when the render-safe projection actually changes, so a
   flood of deltas that don't complete a new component won't thrash the renderer.

The compiler mirrors json-render's `SpecStreamCompiler`: alongside `push`
(accumulated raw text), `pushObject` (an AI-SDK partial object) and `finalize`,
it exposes `getResult()` (the latest snapshot), `reset()` (reuse for a new
stream) and `getPatches()` — a cumulative `VizPatch[]` of RFC-6902-flavored
operations (`add`/`replace`/`remove` at `/components/<i>`, `/title`, …). Where
json-render streams JSON-Patch lines from the model, nikcli derives equivalent
patches by diffing successive render-safe projections, so a consumer can react
to incremental component _adds_ without re-diffing the whole list.

## The registry — pluggable renderers (`dialog-opentui-viz.tsx`)

json-render's defining idea is that the **catalog** (what the model may emit) and
the **registry** (how each type renders) are separate and swappable. nikcli now
models this explicitly:

```ts
import { Renderer, createVizRenderer, defaultVizRegistry } from "@tui/component/dialog-opentui-viz"

// Walk a spec through the built-in registry:
<Renderer spec={snapshot} loading={snapshot.streaming} />

// Swap or extend a renderer without touching the dispatcher:
const renderViz = createVizRenderer({ alert: MyFancyAlert })
```

`ComponentRenderer` resolves `registry[component.type]` (defaulting to
`defaultVizRegistry`) via context — so nested `section`/`grid` containers inherit
the active registry — and wraps each render in a per-component `ErrorBoundary`.

## Two ways to drive it

### 1. Through the agent (already wired)

When the agent calls the `opentui` tool, the streaming JSON of its arguments is
accumulated onto the pending tool part (`session/processor.ts`, `tool-input-delta`
→ `part.state.raw`). This path is **strictly gated to the `opentui` tool** so every
other tool keeps its original cheap no-op (a per-token publish/persist storm across
all tools froze the UI — never do work in `tool-input-delta` for unrelated tools).
It clones rather than mutating the live part, does **no disk write** (transient
UI-only signal, published on the bus), and **throttles** to ~once per 24 chars. The session route
(`routes/session/index.tsx`, `OpenTUIViz`) compiles that raw text with
`compilePartialSpec` and renders completed components **inline, live**, before the
tool call even finishes. Ask the agent to "visualize X" and watch it build.

### 2. Standalone — `streamGenerativeTui` + `<LiveViz />`

`src/cli/cmd/tui/util/generate-viz.ts` streams a spec directly with AI SDK
`streamObject({ schema: VizSpecZod })`, projecting each partial object through the
same compiler:

```ts
import { streamGenerativeTui } from "@tui/util/generate-viz"
import { LiveViz } from "@tui/component/live-viz"

const [snap, setSnap] = createSignal(emptySnapshot)
await streamGenerativeTui({ model, prompt: "dashboard for build health", onSnapshot: setSnap })
// render:  <LiveViz snapshot={snap()} />
```

`<LiveViz />` renders the snapshot incrementally via the shared `ComponentRenderer`;
SolidJS's `<For>` mounts each new component as it validates.

## Tests

- `test/tui/util/spec-stream.test.ts` — partial-JSON repair, render-safe
  projection, and the json-render-parity compiler API (`getResult`, `getPatches`
  patch stream, `reset`).
- `test/tui/util/generate-viz.test.ts` — end-to-end driver with a mock model,
  asserting monotonic, incremental snapshots and a validated final spec.
- `test/tool/opentui-tolerance.test.ts` — input tolerance (wrapped/garbage
  components) plus the `VizCatalog` surface (`componentNames`, `prompt`,
  `zodSchema`, `jsonSchema`, `validate`).
