import { ChatbotWebhook } from "@/chatbot/webhook"

/**
 * `/chatbot/:platform/:name` webhook receivers for the Effect backend.
 *
 * Raw handlers, not an `HttpApi` group: the legacy routes are outside the
 * declared OpenAPI surface (no `describeRoute`) and platform SDKs need the
 * raw `Request` for signature verification, so they follow the same
 * raw-response pattern as `/event`.
 */
export namespace ChatbotHttp {
  /**
   * Exported so `HttpApiBridge` can build its route pattern from the same
   * list this handler validates against — the webhook receiver is not on
   * `PublicApi`, so the bridge cannot derive it from the contract.
   */
  export const PLATFORMS: readonly ChatbotWebhook.Platform[] = [
    "discord",
    "slack",
    "teams",
    "gchat",
    "linear",
    "github",
  ]

  /** Route a `/chatbot/*` webhook request. Returns null when unmatched. */
  export async function handle(request: Request): Promise<Response | null> {
    if (request.method.toUpperCase() !== "POST") return null
    const match = new URL(request.url).pathname.match(/^\/chatbot\/([^/]+)\/([^/]+)$/)
    if (!match) return null
    const platform = match[1] as ChatbotWebhook.Platform
    if (!PLATFORMS.includes(platform)) return null

    const result = await ChatbotWebhook.handle(platform, decodeURIComponent(match[2]), request)
    return new Response(result.body, {
      status: result.status,
      headers: { "content-type": "text/plain; charset=UTF-8" },
    })
  }
}
