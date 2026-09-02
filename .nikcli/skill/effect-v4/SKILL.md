---
name: effect-v4
description: Repo-specific Effect v4 conventions for nikcli. Use when adding Effect code, layers, tagged errors, or a nikcli.json HTTP schema. Upstream docs live in the pinned effect package.
---

# Effect v4 in this repository

Read upstream in the pin, not a vendored copy:

- `node_modules/effect/AGENTS.md`
- `node_modules/effect/ai-docs/src`

Those files exist after `bun install` and move with the Effect version. Do not copy them into this repository.

## Errors

Use `Schema.TaggedError` for expected domain failures. The old constructor name `TaggedErrorClass` is gone as of `4.0.0-beta.104`. Put the class on the Effect error channel; do not `throw` expected failures inside `Effect.gen`.

## Layers and the Promise boundary

Services in `packages/nikcli` export two layers:

- `layer` — provides the service
- `defaultLayer` — `layer` with its dependencies already provided

Promise-side callers use `runPromiseWithLayer` from `packages/nikcli/src/effect/runtime.ts`. `runService(module, effect)` is the same boundary against `module.defaultLayer`. Do not add a second runtime factory or a second instance ALS.

## `nikcli.json`

The on-disk config document is still zod (`packages/nikcli/src/config/config.ts`). HTTP contract schemas for that document go through `fromZod` in `packages/nikcli/src/util/zod-effect.ts`. Do not hand-write a parallel Effect copy of `Config.Info`.

## Check

If an Effect API is new to this pin, confirm it exists under `node_modules/effect` before wrapping it.
