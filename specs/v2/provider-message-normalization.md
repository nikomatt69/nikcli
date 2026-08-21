# Provider Message Normalization

| Field  | Value                                                             |
| ------ | ----------------------------------------------------------------- |
| Status | **Proposed** (tracked by ROADMAP P3)                              |
| Scope  | `src/provider/transform.ts` (`normalizeMessages`, `applyCaching`) |

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

## Invariants to Preserve in P3

- Surrogate sanitization must run on all message content.
- Anthropic/Bedrock must never receive empty content parts.
- Claude and Mistral toolCallId constraints must be preserved.
- Provider-specific reasoning handling (DeepSeek requirement vs KV-cache prefix preservation for optional reasoning) must stay identical.
- P3 should consolidate these passes into a single allocation / single traversal pass.
