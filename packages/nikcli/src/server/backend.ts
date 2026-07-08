import { Flag } from "@/flag/flag"
import { HttpApiBridge } from "./httpapi/bridge"

/**
 * Runtime backend selector for the server.
 *
 * Today the production backend is still Hono. When `NIKCLI_EXPERIMENTAL_HTTPAPI`
 * is enabled, supported paths are delegated to the in-Hono Effect HttpApi bridge.
 * This module centralizes that decision so the future `backend.ts` fork can swap
 * the Hono app for a pure Effect/BunHttpServer backend without scattering flag
 * checks through `server.ts`.
 */
export namespace ServerBackend {
  export type Kind = "hono" | "effect-httpapi-bridge"

  export type Decision = {
    readonly kind: Kind
    readonly reason: "flag-disabled" | "unsupported-route" | "supported-route"
  }

  export type Input = {
    readonly experimentalHttpApi?: boolean
    readonly path: string
    readonly method: string
    readonly supports?: (path: string, method: string) => boolean
  }

  export type GlobalInput = Omit<Input, "supports"> & {
    readonly supportsGlobal?: (path: string, method: string) => boolean
  }

  export type HonoDeletionStatus = "candidate" | "blocked"

  export type HonoDeletionGroup = {
    readonly id: string
    readonly status: HonoDeletionStatus
    readonly reason: string
    readonly routes: readonly string[]
  }

  /**
   * B6 readiness matrix for deleting legacy Hono route groups.
   *
   * These are not delete commands. They document which low-risk JSON-only groups
   * can be removed first once the SDK generator defaults to Effect OpenAPI.
   * Specials (SSE/WS/HTML/mobile) stay blocked until an explicit backend path or
   * product decision exists.
   */
  export const honoDeletionGroups = [
    {
      id: "doctor",
      status: "candidate",
      reason: "single JSON read route bridged by DoctorHttpApi; no stream/websocket special",
      routes: ["GET /doctor"],
    },
    {
      id: "analytics",
      status: "candidate",
      reason: "JSON analytics endpoints are bridged and have no raw response special",
      routes: ["POST /analytics", "GET /analytics"],
    },
    {
      id: "brain",
      status: "candidate",
      reason: "JSON brain routes are bridged and covered by bridge inventory",
      routes: ["GET /brain", "POST /brain/trigger"],
    },
    {
      id: "connectors",
      status: "candidate",
      reason: "JSON connector routes are bridged and have no raw response special",
      routes: [
        "GET /connectors",
        "POST /connectors/git/auth",
        "DELETE /connectors/git/auth",
        "POST /connectors/invalidate",
      ],
    },
    {
      id: "pty-websocket",
      status: "blocked",
      reason: "GET /pty/:id/connect is a websocket Hono special until BunHttpServer exposes upgradeWebSocket",
      routes: ["GET /pty/:ptyID/connect"],
    },
    {
      id: "sync-stream",
      status: "blocked",
      reason: "GET /sync/stream and legacy sync paths are SSE/raw Hono specials",
      routes: ["GET /sync/stream", "POST /sync/event", "GET /sync/outbox", "GET /sync/stats"],
    },
    {
      id: "companion-mobile",
      status: "blocked",
      reason: "companion HTML and mobile surface are separate non-instance surfaces",
      routes: ["/companion/*", "/mobile/*"],
    },
  ] as const satisfies readonly HonoDeletionGroup[]

  export function decide(input: Input): Decision {
    if (input.experimentalHttpApi !== true) {
      return { kind: "hono", reason: "flag-disabled" }
    }
    const supports = input.supports ?? HttpApiBridge.supports
    if (!supports(input.path, input.method)) {
      return { kind: "hono", reason: "unsupported-route" }
    }
    return { kind: "effect-httpapi-bridge", reason: "supported-route" }
  }

  export function shouldUseHttpApiBridge(path: string, method: string): boolean {
    return (
      decide({
        experimentalHttpApi: Flag.NIKCLI_EXPERIMENTAL_HTTPAPI,
        path,
        method,
      }).kind === "effect-httpapi-bridge"
    )
  }

  export function decideGlobal(input: GlobalInput): Decision {
    return decide({
      experimentalHttpApi: input.experimentalHttpApi,
      path: input.path,
      method: input.method,
      supports: input.supportsGlobal ?? HttpApiBridge.supportsGlobal,
    })
  }

  export function shouldUseGlobalHttpApiBridge(path: string, method: string): boolean {
    return (
      decideGlobal({
        experimentalHttpApi: Flag.NIKCLI_EXPERIMENTAL_HTTPAPI,
        path,
        method,
      }).kind === "effect-httpapi-bridge"
    )
  }

  export function deletionGroup(id: string): HonoDeletionGroup | undefined {
    return honoDeletionGroups.find((group) => group.id === id)
  }

  export function canDeleteHonoGroup(id: string, input: { readonly sdkDefaultHttpApi: boolean }): boolean {
    const group = deletionGroup(id)
    return group?.status === "candidate" && input.sdkDefaultHttpApi === true
  }
}
