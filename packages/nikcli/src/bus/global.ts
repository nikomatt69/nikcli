/**
 * Re-export: the bus itself is `@nikcli-ai/util/global-bus`.
 *
 * It moved because the herdr and island bridges need it and they are terminal
 * integrations, not server code — a single `EventEmitter` with no imports of
 * its own was the only thing keeping them on this side of the boundary. Every
 * backend caller keeps this path.
 */
export { GlobalBus } from "@nikcli-ai/util/global-bus"
