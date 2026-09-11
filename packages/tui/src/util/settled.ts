/**
 * Name the failures in a settled batch.
 *
 * `Promise.all` is the wrong primitive for a set of independent best-effort
 * requests: it rejects on the first failure and discards which of the others
 * succeeded, so the caller can only record "something went wrong". Settling
 * keeps every outcome, and this turns the positional results back into the
 * names the caller started with.
 */
export type SettledFailures = {
  /** Names whose request rejected, in the order they were given. */
  readonly failed: string[]
  /** One message per failure, aligned with `failed`. */
  readonly errors: string[]
}

export function namedFailures(names: readonly string[], results: readonly PromiseSettledResult<unknown>[]) {
  if (names.length !== results.length) {
    throw new RangeError(`namedFailures: ${names.length} names for ${results.length} results`)
  }
  const failed: string[] = []
  const errors: string[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status !== "rejected") continue
    failed.push(names[i])
    errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
  }
  return { failed, errors } satisfies SettledFailures
}
