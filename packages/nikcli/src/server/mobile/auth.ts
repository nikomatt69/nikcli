import z from "zod"
import { MobileAuth } from "@/mobile/auth"
import { body, isResponse, json } from "./request"

const CreateInput = z.object({ name: z.string().optional(), expiresInDays: z.number().optional() }).optional()

export async function handleAuthRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (path === "/mobile/auth/token" && request.method === "GET") return json(await MobileAuth.list())
  if (path === "/mobile/auth/token" && request.method === "POST") {
    const input = await body(request, CreateInput)
    if (isResponse(input)) return input
    return json(await MobileAuth.create(input))
  }
  const match = path.match(/^\/mobile\/auth\/token\/([^/]+)$/)
  if (match && request.method === "DELETE")
    return json({ revoked: await MobileAuth.remove(decodeURIComponent(match[1])) })
}
