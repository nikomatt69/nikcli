/**
 * Writer for schema members declared with `Schema.optionalKey`.
 *
 * `Schema.optional(X)` is `optionalKey(UndefinedOr(X))`, so `undefined` is a
 * valid union member and the HTTP encode path serializes it as `null`.
 * `Schema.optionalKey(X)` has no such member: it accepts an *absent* key and
 * **rejects a present `undefined`** at encode time. A `draft.field = undefined`
 * against one of those schemas therefore does not produce an omitted field —
 * it fails the response encode and answers 400.
 *
 * That is not hypothetical. It shipped twice: `config/tui.ts` wrote
 * `plugin_meta = undefined` and `GET /tui/config` answered an empty 400 for
 * every user with no plugins, and `mission.ts` `featureMutate` wrote
 * `error = undefined` and `POST /mission/:id/feature/:id` answered 400 on
 * `status: "done"`. Neither is visible to `bun run typecheck`, because
 * `exactOptionalPropertyTypes` is off — `field?: X` still accepts `undefined`.
 *
 * Use this when the value may be absent. Assign directly when it cannot be.
 * In an object literal, `...(value !== undefined && { key: value })` says the
 * same thing.
 */
export function setOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete (target as Record<PropertyKey, unknown>)[key as PropertyKey]
  else target[key] = value
}

/**
 * The object-literal form: `{ ...spreadIf("key", maybeValue) }` contributes the
 * key only when the value is present. Use it where there is no draft to mutate
 * — a builder that returns a fresh record, which is where most of these bugs
 * live.
 */
export function spreadIf<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}
