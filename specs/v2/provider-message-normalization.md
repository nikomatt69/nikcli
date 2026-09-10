# Provider Message Normalization

| Field  | Value                                                                          |
| ------ | ------------------------------------------------------------------------------ |
| Status | **Accepted and implemented** (promoted 2026-09-10; P3 closed 2026-08-24)       |
| Scope  | `src/provider/transform.ts` (`normalizeMessages`, `applyCaching`)              |
| Tests  | `test/provider/transform-normalize.test.ts`, `test/provider/transform.test.ts` |

The question this records: what transformations are applied to outgoing messages before sending them to AI providers, and what invariants must be preserved when P3 refactors the function.

The answer is **a multi-pass message sanitization and provider-specific normalization pipeline** that adapts AI SDK message structures to the quirks of Anthropic, Bedrock, Claude, Mistral, and DeepSeek backends.

## The Surface

`normalizeMessages` in `src/provider/transform.ts` runs on every LLM call before provider transmission. It is flagged with `// TODO: fix this stupid inefficient dogshit function` because it runs multiple array allocations and regex passes per message.

## Current Normalization Passes

1. **Surrogate pair sanitization**: Replaces lone or mismatched Unicode surrogates with `\uFFFD` across tool results, system messages, user messages, and assistant messages.
2. **Empty message / part pruning (Anthropic & Bedrock)**: Filters out empty text messages and empty reasoning blocks (unless reasoning carries signature or redactedData metadata).
3. **Tool call ID scrubbing (Claude)**: Replaces characters outside `[a-zA-Z0-9_-]` with `_`.
4. **Tool-use ordering fix (Anthropic)**: Reorders turns where text follows tool calls into `[text]` followed by `[tool_use...]` to satisfy Anthropic API constraints.
5. **Tool message sequencing & ID fix (Mistral)**: Truncates/pads tool IDs to 9 alphanumeric characters; inserts a synthetic assistant `"Done."` message if a `tool` message is immediately followed by a `user` message.
6. **Reasoning injection (DeepSeek)**: Ensures every assistant message includes a reasoning part (injects empty reasoning if missing).
7. **Interleaved reasoning extraction**: For providers supporting interleaved reasoning fields (e.g. `reasoning_content`), extracts reasoning from content parts and places it into `providerOptions.openaiCompatible[field]`, leaving it absent when no reasoning occurred to preserve KV-cache prefix matching.

## Cache Policy Interaction

`applyCaching` in `src/provider/transform.ts` uses `CachePolicy.plan` to place cache breakpoints within budget constraints (maximum 4 breakpoints for Anthropic/Bedrock).

## Invariants

Each is pinned by a case in `test/provider/transform-normalize.test.ts`:

- Surrogate sanitization runs on all message content, including structured tool results, and leaves valid surrogate pairs alone. It mutates the caller's messages in place, parts included.
- Anthropic and Bedrock never receive empty content parts; empty reasoning survives only when it carries a signature or redacted data.
- Claude and Mistral tool-call id constraints hold on both sides of the call, and an assistant turn whose tool calls are followed by other content is split.
- Provider-specific reasoning handling stays as it is: every DeepSeek assistant turn gets a reasoning part, and the Mistral branch returns before DeepSeek's injector also runs.

**P3 is closed (2026-08-24) and did not consolidate the passes.** The function was characterized and deliberately left alone on the measurement — see the ROADMAP entry. The `// TODO: fix this stupid inefficient dogshit function` comment above it is therefore a description of its shape, not an outstanding item. Anyone who reopens the rewrite inherits the list above as the acceptance gate.
