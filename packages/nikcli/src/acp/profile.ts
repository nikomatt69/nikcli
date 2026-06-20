/**
 * ACP performance profiling helpers.
 *
 * Mirrors opencode's `profile.ts` so we can A/B compare timings with the
 * same vocabulary. Set `NIKCLI_ACP_PROFILE=1` to enable; otherwise every
 * helper is a no-op so there is no overhead in production.
 *
 * Output is written to stderr to avoid interfering with the JSON-RPC
 * stream on stdout.
 */

const enabled = process.env["NIKCLI_ACP_PROFILE"] === "1"
const started = performance.now()

/**
 * Emit a one-shot duration marker. The fields are appended in
 * alphabetical order to the line so log-grepping stays predictable.
 */
export function duration(
  name: string,
  startedAt: number,
  fields?: Record<string, string | number | boolean | undefined>,
): void {
  if (!enabled) return
  write(name, performance.now() - startedAt, fields)
}

/**
 * Convenience wrapper that measures an awaited function and emits a
 * duration marker named `name`. Returns whatever the function returns.
 */
export async function measure<T>(
  name: string,
  fn: () => Promise<T>,
  fields?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  if (!enabled) return fn()
  const start = performance.now()
  try {
    return await fn()
  } finally {
    write(name, performance.now() - start, fields)
  }
}

/**
 * Emit a one-shot absolute-time marker. Useful for stage boundaries
 * (e.g. "before sending the prompt", "after the prompt returned").
 */
export function mark(name: string, fields?: Record<string, string | number | boolean | undefined>): void {
  if (!enabled) return
  write(`${name}.mark`, performance.now() - started, fields)
}

function write(name: string, durationMs: number, fields?: Record<string, string | number | boolean | undefined>): void {
  const extra = fields
    ? Object.entries(fields)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")
    : ""
  // eslint-disable-next-line no-console
  console.error(`[acp-profile] ${name} ${Math.round(durationMs)}ms${extra ? ` ${extra}` : ""}`)
}

export * as ACPProfile from "./profile"
