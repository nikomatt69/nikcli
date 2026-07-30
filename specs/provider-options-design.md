# Per-provider, per-model option modules

Goal: every provider in `packages/llm/src/providers/` exposes a typed, reasoning-aware option facade analogous to `openai-options.ts`, with per-model default resolvers (e.g. `claude-opus-4-*` → thinking budget, `gemini-2.5-*` → thinkingConfig, `grok-3-mini` → reasoningEffort). Mirrors how opencode's `provider/transform.ts` keys defaults off `model.api.id` patterns and exposes named reasoning variants.

## Wire contract

The protocol layer already reads `providerOptions[<key>]` for:

| Protocol             | Key          | Knobs consumed                                                                                     |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| `openai-responses`   | `openai`     | store, promptCacheKey, reasoningEffort, reasoningSummary, includeEncryptedReasoning, textVerbosity |
| `openai-chat`        | `openai`     | store, reasoningEffort (no verbosity field)                                                        |
| `anthropic-messages` | `anthropic`  | `thinking.{type:"enabled", budgetTokens}`                                                          |
| `gemini`             | `gemini`     | `thinkingConfig.{thinkingBudget, includeThoughts}`                                                 |
| `openrouter`         | `openrouter` | usage, reasoning, promptCacheKey                                                                   |
| `bedrock-converse`   | `bedrock`    | passthrough → `additionalModelRequestFields` (needs new wiring)                                    |

Option modules therefore just produce a `ProviderOptions` map keyed by those names. Merge happens via `mergeProviderOptions`.

## Files added

```
providers/anthropic-options.ts     // thinking budget / adaptive for claude-* on Anthropic, Bedrock, Vertex, OpenRouter
providers/google-options.ts        // thinkingConfig for gemini-2.5*, gemini-3* (incl. thinkingBudget caps)
providers/xai-options.ts           // reasoningEffort for grok-3-mini, grok-4*; xai also re-exports OpenAI options for non-mini grok
providers/openrouter-options.ts    // typed wrappers: usage, reasoning.effort, promptCacheKey + per-model defaults
providers/bedrock-options.ts       // reasoningConfig (adaptive vs enabled) per anthropic/* and Nova on Bedrock; also passthrough
providers/cloudflare-options.ts    // reasoningEffort for openai/* AI Gateway models
providers/copilot-options.ts       // copilot-specific tweaks on top of OpenAI options (claude on copilot uses reasoningEffort, gemini disabled)
```

Each module exports:

1. `<Provider>OptionsInput` — typed interface of the knobs the protocol reads.
2. `<Provider>ProviderOptionsInput = ProviderOptions & { [key]?: ... }` — what callers pass via `providerOptions`.
3. A pure `<provider>DefaultOptions(modelID)` resolver — returns a `ProviderOptions | undefined` with per-model defaults; matches via lower-cased substring patterns and dates where relevant.
4. `with<Provider>Options(modelID, options)` — merges defaults + user-supplied options + assigns `id`.

## Per-model default tables

### Anthropic (`anthropic-options.ts`)

- `claude-opus-4-7*`, `claude-opus-4-6*`, `claude-sonnet-4-6*` → `{ thinking: { type: "enabled", budgetTokens: 16000 } }` (medium default; user can override or `withAnthropicVariants(modelID, "max")` for 31999).
- `claude-opus-4-5*` → `{ thinking: { type: "enabled", budgetTokens: 16000 } }`.
- Older claude (`claude-3-*`, `claude-3-5-*`, `claude-3-7-*`) → no thinking.
- Exposed `AnthropicVariants` = `{ low: 4000, medium: 16000, high: 24000, max: 31999 }`.

### Google (`google-options.ts`)

- `gemini-2.5-pro*` → `{ thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } }`. Max budget cap 32768.
- `gemini-2.5-flash*` → `{ thinkingConfig: { includeThoughts: true, thinkingBudget: 8000 } }`. Max budget cap 24576.
- `gemini-2.0-flash-thinking*` → `{ thinkingConfig: { includeThoughts: true } }`.
- `gemini-3-*` (when present) → `{ thinkingConfig: { includeThoughts: true } }` (thinkingLevel knob added later when protocol supports it).
- Older gemini → no thinking.

### xAI (`xai-options.ts`)

- `grok-3-mini*` → `{ openai: { reasoningEffort: "medium" } }` (xAI routes through OpenAI Responses + Compatible Chat protocols, so it reads from the `openai` key).
- `grok-4*` → defaults to OpenAI semantics; uses `gpt5DefaultOptions`-style for `reasoningEffort: "medium"`.
- Non-mini grok-3 / grok-2 → none.

### OpenRouter (`openrouter-options.ts`)

- Pattern-detected sub-provider:
  - `openai/gpt-5*` → `{ openrouter: { reasoning: { effort: "medium" } } }`
  - `anthropic/claude-*4.*:thinking` or `:reasoning` → `{ openrouter: { reasoning: { effort: "high" } } }`
  - `google/gemini-2.5-*`, `google/gemini-3-*` → `{ openrouter: { reasoning: { effort: "medium" } } }`
  - `xai/grok-3-mini*` → `{ openrouter: { reasoning: { effort: "medium" } } }`
  - All → ` { openrouter: { usage: true } }` so token usage is included.

### Amazon Bedrock (`bedrock-options.ts`)

- `anthropic.claude-opus-4-7*` → adaptive `{ bedrock: { reasoningConfig: { type: "adaptive", maxReasoningEffort: "medium", display: "summarized" } } }`.
- `anthropic.claude-opus-4-6*`, `anthropic.claude-sonnet-4-6*`, `*claude-sonnet-4-5*` → adaptive `{ maxReasoningEffort: "medium" }`.
- `anthropic.claude-3-7-sonnet*` → `{ reasoningConfig: { type: "enabled", budgetTokens: 16000 } }`.
- `us.amazon.nova-premier*` / `us.amazon.nova-pro*` → `{ reasoningConfig: { type: "enabled", maxReasoningEffort: "medium" } }`.
- Other (non-anthropic, non-nova) → none.

### Cloudflare AI Gateway (`cloudflare-options.ts`)

- `openai/gpt-5*` → `{ openai: { reasoningEffort: "medium", reasoningSummary: "auto" } }`.
- `anthropic/claude-*4*` → `{ anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } } }`.
- `google/gemini-2.5*` → `{ gemini: { thinkingConfig: { includeThoughts: true, thinkingBudget: 8000 } } }`.

### GitHub Copilot (`copilot-options.ts`)

- Layered on top of `openAIDefaultOptions(modelID)`:
  - `claude-*` on copilot → `{ openai: { reasoningEffort: "medium" } }` (no summary / encrypted).
  - `gemini*` on copilot → none (copilot doesn't expose reasoning for gemini).
  - `gpt-5*`, `gpt-5.1-codex-max` → OpenAI defaults already provide the right knobs.

## Merge order at call time

```
withFooOptions(modelID, userOptions) →
  mergeProviderOptions(
    fooDefaultOptions(modelID),     // provider+model defaults
    userOptions.providerOptions     // caller overrides (last writer wins per key)
  )
```

This matches opencode's `base → model.options → agent.options → variant` chain collapsed into one merge at the model factory boundary. Variant selection (low/medium/high/max) can be layered as a future `Variants.apply(modelID, effort)` helper that returns a `ProviderOptions` to feed into the merge — already supported by the merge semantics, no API change needed.

## Re-exports

`providers/index.ts` adds the same namespace pattern as `OpenAIProviderOptions`:

```ts
export * as AnthropicProviderOptions from "./anthropic-options"
export * as GoogleProviderOptions from "./google-options"
export * as XAIProviderOptions from "./xai-options"
export * as OpenRouterProviderOptions from "./openrouter-options"
export * as BedrockProviderOptions from "./bedrock-options"
export * as CloudflareProviderOptions from "./cloudflare-options"
export * as CopilotProviderOptions from "./copilot-options"
```

## Wiring providers

Each existing provider file consumes its options module:

- `anthropic.ts` → routes through `withAnthropicOptions(id, options)`.
- `google.ts` → `withGoogleOptions(id, options)`.
- `xai.ts` → `withXAIOptions(id, options)` (which under the hood calls `withOpenAIOptions` plus xAI-specific defaults).
- `openrouter.ts` → `withOpenRouterOptions(id, options)` replaces hand-rolled bodyOptions plumbing's defaults.
- `amazon-bedrock.ts` → `withBedrockOptions(id, options)`.
- `cloudflare.ts` → `withCloudflareOptions(id, options)`.
- `github-copilot.ts` → `withCopilotOptions(id, options)` (wraps `withOpenAIOptions`).

`Provider.id` (e.g. `"anthropic"`) is exported from `provider.ts` so type-checks remain stable.

## Bedrock protocol patch

`bedrock-converse.ts:fromRequest` currently ignores `providerOptions.bedrock`. Add a small `bedrockOptions(request)` reader that emits `additionalModelRequestFields` from the `bedrock` namespace so `withBedrockOptions` defaults take effect on the wire. Pure additive change.

## Type-level inference at the request boundary

*(implemented 2026-07-30; ports opencode v2 #39493 + #39510)*

The option modules above make the *defaults* provider-aware, but the call site still had no
protection: `ProviderOptions` is `Record<string, Record<string, unknown>>` on the wire, so
`{ anthropic: { thinkingBudget: 4000 } }` (the field is `thinking`) type-checked, shipped, and was
silently dropped by the provider.

The wire schema deliberately stays open — nikcli cannot know every provider's knobs, and a model
resolved from config carries no type at all. Instead the *model* carries its option shape in the
type system only:

```
schema/provider-options-typing.ts
  TypedModelRef<Options>   ModelRef + a phantom, optional carrier property
  ProviderOptionsOf<M>     the options a model accepts, falling back to ProviderOptions
```

`LLM.request` is generic over the model, so `providerOptions` is checked against
`ProviderOptionsOf<typeof model>`.

Two properties worth preserving when touching this:

- **Nothing changes at runtime.** The carrier is a phantom type: no value is added, nothing is
  serialized, and a plain `ModelRef` remains assignable in both directions. Untyped models simply
  get the open `ProviderOptions` fallback.
- **Providers opt in by annotating their return type**, e.g.
  `export const model = (...): TypedModelRef<AnthropicProviderOptionsInput> => ...`. No wrapper
  call is needed, because the carrier is optional and a plain `ModelRef` already satisfies the
  branded type. An earlier `typedModel()` helper was removed for exactly this reason — it was a
  second way to express the same thing.

Typed today: `anthropic`, `google`, `openai` (responses/chat/websocket), `xai`, `openrouter`,
`azure`, `amazon-bedrock`, `github-copilot`, `openai-compatible`, `cloudflare` (aiGateway/workersAI).
Adding a provider is one return-type annotation plus a case in
`test/provider-options-typing.test.ts`.
