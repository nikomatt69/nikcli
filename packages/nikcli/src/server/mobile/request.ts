import type z from "zod"

export type MobileRouteHandler = (request: Request, params: Readonly<Record<string, string>>) => Promise<Response>

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const result = Response.json(value, { status, headers })
  return result
}

export async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T> | Response> {
  let value: unknown
  try {
    const text = await request.text()
    value = text ? JSON.parse(text) : undefined
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }
  const result = schema.safeParse(value)
  if (!result.success) {
    return json({ error: "Validation failed", issues: result.error.issues }, 400)
  }
  return result.data
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response
}

export function proxyResponse(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  })
}

export function query<T extends z.ZodType>(request: Request, schema: T): z.output<T> | Response {
  const values: Record<string, string> = {}
  for (const [key, value] of new URL(request.url).searchParams) values[key] = value
  const result = schema.safeParse(values)
  if (!result.success) return json({ error: "Validation failed", issues: result.error.issues }, 400)
  return result.data
}
