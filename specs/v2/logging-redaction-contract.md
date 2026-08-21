# Logging Redaction Contract

| Field  | Value                                                                                       |
| ------ | ------------------------------------------------------------------------------------------- |
| Status | **Proposed**                                                                                |
| Scope  | `packages/util/src/redact.ts`, `packages/util/src/log.ts`, `packages/util/src/cli-error.ts` |
| Tests  | `packages/nikcli/test/util/redact.test.ts`                                                  |

The question this records: what nikcli guarantees about secrets in logs, and the one escape hatch.

The answer is **default-on redaction in `@nikcli-ai/util`**: `Log` serializes through `safeStringify` unless `NIKCLI_LOG_REDACT=0`. The token is `[REDACTED]`. There is no `packages/nikcli/src/util/redact.ts`.

## The Surface

`packages/util/src/redact.ts` owns `redactValue`, `redactString`, `safeStringify`, `discover`. `packages/util/src/log.ts` consults the env flag **per write**. `packages/util/src/cli-error.ts` uses the same helpers for user-facing error text.

## What is redacted

Three classes, from the module header:

1. **Keys** in `REDACT_KEYS` (matched original and lowercased): `token`, `secret`, `password`, `authorization`, `auth`, `cookie`, `code`, `state`, `apikey`, `api_key`, `session`, `bearer`, `x-api-key`, `x_api_key`, `access_token`, `accessToken`, `refresh_token`, `refreshToken`, `client_secret`, `clientSecret`, `private_key`, `privateKey`, `credential`, `credentials`. Those values become `[REDACTED]`.
2. **URL query credentials** via `URL_CREDENTIAL_RE`: `token`, `code`, `access_token`, `refresh_token`, `api_key`, `apikey`, `state`, `session`, `password`, `secret` → `key=[REDACTED]`.
3. **Secret-shaped substrings** (`REDACT_PATTERNS`): `sk-…`, GitHub PATs (`ghp_`, `ghs_`, `github_pat_`), Slack `xox[abprs]-…`, JWT-shaped `eyJ…`.

`safeStringify` runs `redactValue` then `JSON.stringify`. Cycles → `[circular]`. Depth cap 4 → `[max-depth]`. String leaves cap 4096 then `...[truncated]`. Functions/symbols drop. Errors keep `{ name, message }` with the message redacted.

There is no separate `redactUrl` export in this module (HTTP recorder has its own).

## Escape hatch

`NIKCLI_LOG_REDACT=0` makes `Log` use `JSON.stringify` instead of `safeStringify`. Consulted per write, so it does not require a restart. The operator then owns the line: do not ship it to a public sink.

## What is not redacted

By design the logger does not rewrite:

- File paths
- Model ids
- Tool output / user prompt text, except where a value matches a key or pattern above
- Stack traces (`formatStack` in `cli-error.ts` is gated by `NIKCLI_DEBUG=1`, which is visibility, not redaction)

A string that is not a named key and not pattern-shaped stays.

## Alternatives Rejected

**Per-logger redaction.** A bypass is then per-logger. One module, one flag.

**Allow-list of safe strings.** False-negative rate too high.

**Redact the LLM prompt.** The logger does not change model input.

## Invariants

- Production `Log` writes go through `safeStringify` unless the env flag is `0`.
- Replacement token is `[REDACTED]`.
- Adding a key or pattern is a contract change; pin it in `test/util/redact.test.ts`.

## What Is Explicitly Not Covered

- OTLP / analytics exporters (they must not log raw spans with secrets; that is their problem).
- Mobile app logs.
- Share payload filtering (see [share v2](./share-v2-contract.md) — ShareNext does not call this module today).
