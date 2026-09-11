# Provider and Model Catalog

| Field  | Value                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Status | **Accepted and implemented** (documented 2026-09-11)                                                                                      |
| Scope  | `src/provider/schema.ts`, `src/provider/provider.ts`, `src/provider/models.ts`, `src/provider/variants.ts`, `packages/llm`                |
| Tests  | `test/provider/core.test.ts`, `test/provider/variants.test.ts`, `test/provider/transform.test.ts`, `test/provider/effect-service.test.ts` |

The question this records: what a provider and a model **are** in nikcli, how the catalog is built
from six ordered sources, and how a catalog model turns into something that can stream tokens.

Invalidation is not covered here — see
[catalog-config-plugin-lifecycle.md](./catalog-config-plugin-lifecycle.md). Availability rules are
not covered here — see [provider-policy.md](./provider-policy.md).

## Two Representations, Deliberately

| Shape                                    | Where                    | Job                                                        |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `ModelsDev.Provider` / `ModelsDev.Model` | `src/provider/models.ts` | The upstream models.dev document, used to seed the catalog |
| `Provider.Info` / `Provider.Model`       | `src/provider/schema.ts` | The normalized internal record every consumer reads        |

The canonical schema lives in `schema.ts`, separate from the build pipeline in `provider.ts`, so a
consumer can import the contract without dragging the SDK factory and the models.dev loader with it.

Both are Effect `Schema.Struct`s exposed as zod objects through `zodObject` from
`@nikcli-ai/util/effect-zod`, because the HTTP boundary and the JSON Schema emitter both need the zod
view. The Effect schema is the source; the zod object is derived.

## Provider

```ts
Provider.Info = {
  id: string
  name: string
  source: "env" | "config" | "custom" | "api"
  env: string[]
  key?: string
  options: Record<string, unknown>
  models: Record<string, Model>
}
```

`source` is the one field that differs most from upstream's proposed `ProviderV2`. Upstream models
availability as a union — `false | { via: "env", name } | { via: "account", service } | { via:
"custom", data }` — so "is it usable" and "how did it become usable" are the same field. nikcli
records only **how**, and answers **whether** by presence: a provider that is not usable is not in
the map. `Policy` decides which ids are allowed to enter it at all.

Models are nested under their provider because model ids are only unique within a provider. nikcli
and upstream agree on that.

## Model

```ts
Provider.Model = {
  id, providerID, name, family?
  api: { id: string; url?: string; npm: string }
  capabilities: {
    temperature, reasoning, attachment, toolcall: boolean
    input / output: { text, audio, image, video, pdf: boolean }
    interleaved: boolean | { field: "reasoning_content" | "reasoning_details" }
  }
  cost: { input, output, cache: { read, write }, experimentalOver200K?: { … } }
  limit: { context: number; input?: number; output: number }
  status: "alpha" | "beta" | "deprecated" | "active"
  options: Record<string, unknown>
  headers: Record<string, string>
  release_date: string
  variants?: Record<string, Record<string, unknown>>
}
```

Three shapes worth calling out:

- **`api.url` is optional.** Custom and config-only providers usually leave the base URL implicit,
  resolved later from `options.baseURL` or the npm package default. Requiring it rejected real
  `/config/providers` payloads at the Effect HttpApi boundary even though the old Hono route never
  validated them — the Effect bridge validates response bodies at runtime and Hono did not, so every
  strict field in a provider schema needs checking against real payloads before it lands.
- **`api.npm` is the routing key**, not a display field. It is what `mapToModelRef` switches on.
- **Tiered pricing is one optional override, not a list.** Upstream models `cost` as an array of
  tiers keyed by context size. nikcli has exactly one tier that exists in practice —
  `experimentalOver200K` — and names it rather than generalizing.

`capabilities.interleaved` carries either a boolean or the reasoning field name, which is how a
single flag covers both "does this model interleave reasoning" and "under which response key".

## How The Catalog Is Built

`buildState(ctx)` in `src/provider/provider.ts` runs once per instance directory and produces
`{ providers, models, sdk, languages, images, modelLoaders }`. The provider map is assembled by
repeated `mergeProvider(providerID, partial)` calls, each merged deeply over what is already there,
in this order:

1. **models.dev database** — `ModelsDev.get()` mapped through `fromModelsDevProvider`. This is the
   seed, not a registration: an entry here only becomes a provider when a later step merges into it.
2. **Dynamic discovery** — Requesty model discovery (cached), local Ollama auto-detection, and the
   synthetic `github-copilot-enterprise` clone of `github-copilot`.
3. **Config providers** — `config.provider.*`, `source: "config"`.
4. **Environment** — for each database provider whose `env` list resolves to a set variable,
   `source: "env"`. The key is captured only when the provider declares exactly one variable;
   ambiguity is left to the SDK.
5. **Stored API keys** — `Auth` entries of `type: "api"`, `source: "api"`.
6. **Plugin auth loaders** — a plugin declaring `auth.provider` with a `loader`, `source: "custom"`.
   GitHub Copilot is special-cased so enterprise credentials also activate the base provider.

Every step is gated by `isProviderAllowed(providerID)`, which evaluates the `provider.use` action
against the central policy statements. A denied provider never enters the map, so denial is invisible
rather than filtered downstream.

`mergeProvider` also handles the provider that does not exist in models.dev at all: it synthesizes an
entry from the config declaration plus whatever the caller supplied, which is what makes
`nikcli-inference`, Ollama, and bare config providers visible without a catalog entry.

## Variants

A variant is a named bundle of provider options — reasoning effort, thinking budget, toggles.

nikcli stores them as `Record<variantName, providerOptions>`; upstream v2 uses an array of
`{ id, ...options }`. The Record was kept because every call site — `session/llm.ts`, `acp/*`, the
TUI variant picker — looks variants up by name.

Derivation is data-driven first, procedural second (`src/provider/variants.ts`):

- `reasoningVariants(model, npm)` reads the models.dev per-model `reasoning_options` field and maps
  each option (`effort`, `toggle`, `budget_tokens`) onto the provider-options shape the model's npm
  package expects.
- When `reasoning_options` is absent it returns `{}`, and callers fall back to the procedural
  `ProviderTransform.variants(model)` so models whose catalog entries have not been migrated upstream
  still get variants.
- The OpenRouter "Fusion" meta-model is special-cased: no `reasoning_options`, but it still exposes
  the `quality` / `budget` presets the TUI Fusion manager manages.

## Selection

```ts
interface Provider.Interface {
  list(): Effect<Record<string, Info>>
  getProvider(providerID): Effect<Info | undefined>
  getModel(providerID, modelID): Effect<Model, Error>
  getLanguage(model): Effect<LanguageModelV2, Error>
  getImageModel(model): Effect<ImageModel, Error>
  getModelRef(model): Effect<ModelRef | undefined>
  closest(providerID, query[]): Effect<{ providerID, modelID } | undefined>
  getSmallModel(providerID): Effect<Model | undefined, Error>
  defaultModel(): Effect<{ providerID, modelID }>
  refresh(): Effect<void>
}
```

**`defaultModel()`** takes `config.model` when it names an available model, and otherwise falls
through to `bestAvailable()` — every model in the catalog run through `Provider.sort`, first one
wins. `sort` ranks by a hardcoded `priority` id-substring list, then prefers non-`latest` ids, then
sorts by id descending. When the catalog is empty it returns `{ providerID: "nikcli", modelID: "" }`,
which is a sentinel rather than a usable model.

**`getSmallModel(providerID)`** resolves `config.small_model` when set. An explicit empty string
**disables** the small-model fallback entirely — distinct from unset, which continues to the
heuristics: for `nikcli*` and `github-copilot*` providers it scans that provider's models for a
`priority` substring match, and finally falls back to `nikcli/gpt-5-nano` when that provider is
present.

nikcli therefore keeps `small_model`, which upstream's config review proposes to remove in favor of a
`title` agent model override. The reason is that nikcli's consumer set is wider than title
generation.

## From Catalog Model To Wire

`mapToModelRef(model, providerInfo)` is the bridge to `@nikcli-ai/llm`'s route system. It switches on
`model.api.npm`:

| npm                           | Route                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `@ai-sdk/openai`              | `OpenAI.responses` — unless `providerID` says otherwise |
| `@ai-sdk/anthropic`           | `Anthropic.model`                                       |
| `@ai-sdk/google`              | `Google.model`                                          |
| `@ai-sdk/amazon-bedrock`      | `AmazonBedrock.model` (`options.region`)                |
| `@ai-sdk/xai`                 | `XAI.responses`                                         |
| `@openrouter/ai-sdk-provider` | `OpenRouter.model`                                      |

`@ai-sdk/openai` is shared by OpenAI, Azure, and GitHub Copilot, so the switch disambiguates by
`providerID` substring: Copilot gets `GitHubCopilot.model` with the model headers attached, Azure
gets `Azure.model` with a `resourceName` taken from config or extracted from the base URL
(`https://<name>.openai.azure.com`).

Credentials resolve as `providerInfo.options.apiKey ?? providerInfo.key`; the base URL as
`model.api.url || providerInfo.options.baseURL`.

**Failure is `undefined`, not an error.** An unmapped npm, a constructor that throws, or a missing
provider record all log a warning and return `undefined`. That is the contract: `getModelRef`
returning nothing means "no native route", and the caller uses the AI SDK path instead. Native
streaming is additionally gated by `experimental.nativeLlm`, which is off by default.

## Alternatives Rejected

**Branded id schemas.** Upstream brands `ProviderV2.ID` and `ModelV2.ID` and attaches static
constructors for known providers. nikcli keeps plain strings because provider ids arrive from config,
plugins, and discovery at runtime, where a closed static list is a liability rather than a guarantee.

**An `Endpoint` union on the provider.** Upstream models the transport as
`openai/responses | openai/completions | anthropic/messages | aisdk | unknown` on both provider and
model, and resolves `unknown` at read time. nikcli carries the npm package name instead and resolves
transport once, in `mapToModelRef`. The npm field already exists in models.dev, so nothing has to be
inferred or backfilled.

**`empty()` constructors.** Upstream's update-by-draft API needs a record to mutate before it exists.
nikcli's catalog is rebuilt, not mutated, so there is nothing for `empty()` to seed.

## Invariants

- A model id is unique only within its provider; models are always addressed as a pair.
- A provider absent from `list()` is unavailable — there is no disabled-but-present state.
- `Policy` denial happens during construction, so a denied provider is absent from every consumer,
  including the catalog itself.
- `getModelRef` never fails; absence means "fall back to the AI SDK".
- `refresh()` invalidates **every** cached directory entry, not just the current one, because
  `auth.json` and global config are shared across instances.

## Gaps Versus Upstream v2

These are known differences, not bugs. Each would be its own change.

- No plugin hook surface for catalog mutation (`provider.update`, `model.update`). nikcli's
  extension points are config, auth loaders, and discovery functions, all consumed during
  `buildState`.
- No account abstraction. Credentials are `Auth.Info` records keyed by provider id; there is no
  `AccountV2` with activation semantics.
- No ordered plugin registration (`modelsDev: 0, env: 10, account: 20, …`). Order is the literal
  statement order in `buildState`.
- `Model.family` exists but is unused by selection; upstream treats it as a first-class grouping key.
