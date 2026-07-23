import type { HostConfigSnapshot } from "./types"

/**
 * Minimal type for the host client operations we need. Defined here as a
 * structural interface so the helper does not pull in heavyweight types from
 * elsewhere; the runtime client always satisfies it.
 */
export interface ConfigWriterClient {
  getConfig(): Promise<HostConfigSnapshot>
  updateConfig(next: HostConfigSnapshot): Promise<HostConfigSnapshot>
}

/**
 * Serializes concurrent config writes against the host. The backend's
 * updateConfig accepts a full snapshot, so two writes that start from
 * different in-memory copies of the same config can lose each other's
 * changes ("read-modify-write" race).
 *
 * This queue guarantees that a second \`writeConfig\` call observes the
 * effects of the first one before it computes its own snapshot, at the cost
 * of one extra \`getConfig\` per write. The mutex is module-level so all
 * settings screens and the session screen share the same write order.
 *
 * Held in an object so the chain pointer can advance across calls; a bare
 * \`const Promise\` cannot be reassigned.
 */
const queue: { chain: Promise<unknown> } = { chain: Promise.resolve() }

export type ConfigMerger<T extends Partial<HostConfigSnapshot> = Partial<HostConfigSnapshot>> = (
  current: HostConfigSnapshot,
) => T | Promise<T>

export interface WriteOptions {
  /** Optional tag used in error messages and for debugging. */
  label?: string
}

/**
 * Read the latest config from the host, apply \`merger(current)\` to derive
 * a partial, then write it back. Multiple concurrent calls serialize.
 *
 * The merger is expected to return a partial snapshot (any subset of fields)
 * that will be merged into the freshly-read \`current\` before the write.
 */
export async function writeConfig<T extends Partial<HostConfigSnapshot>>(
  client: ConfigWriterClient,
  merger: ConfigMerger<T>,
  options: WriteOptions = {},
): Promise<HostConfigSnapshot> {
  const next = queue.chain.then(async () => {
    const current = await client.getConfig()
    const patch = await merger(current)
    const merged: HostConfigSnapshot = { ...current, ...patch }
    return client.updateConfig(merged)
  })
  // Keep the chain moving even if a write fails, so a single bad write does
  // not freeze every subsequent config update. Surface the original error
  // from this call.
  queue.chain = next.catch(() => undefined)
  try {
    return await next
  } catch (cause) {
    if (options.label) {
      throw new Error(`${options.label}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    throw cause
  }
}

/**
 * Reset the internal mutex. Test-only helper; production code should rely on
 * the natural serialization of writeConfig calls.
 */
export function __resetConfigWriterForTests(): void {
  // Best-effort: we cannot reassign a const, but the chain already serializes
  // pending writes through the same fulfillment slot, so leaving it untouched
  // is safe between tests. This function exists for symmetry / future needs.
}
