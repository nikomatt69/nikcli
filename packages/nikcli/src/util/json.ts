/**
 * The value domain of JSON-serializable data: what `JSON.parse` produces and
 * what a wire contract may carry. Use it at parse boundaries instead of
 * leaking `unknown` (or `any`) into callers.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue }
