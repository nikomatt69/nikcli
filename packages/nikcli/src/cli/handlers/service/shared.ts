
/** Helpers shared by the `service` commands. */

/**
 * Manage the shared background service.
 *
 * The handlers import `@/service/service` lazily. This module is registered in
 * `cli-main`, so a static import would pull the service module — and through it
 * `Installation` and the global paths — into every nikcli start, including the
 * ones that never touch the service. See `specs/background-service.md`.
 */
export async function service() {
  const { BackgroundService } = await import("@/service/service")
  return BackgroundService
}





export async function config() {
  const { ServiceConfig } = await import("@/service/config")
  return ServiceConfig
}
