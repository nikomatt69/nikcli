import type { Context, MiddlewareHandler } from "hono"
import type { AuthContext } from "./claims"
import { verifyAccessToken, type VerifyAccessTokenOptions } from "./verify"

export type AuthVariables = {
  auth: AuthContext
}

export function parseBearerToken(value?: string | null): string | null {
  if (!value) return null
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim())
  return match?.[1] ?? null
}

export function requestToken(request: Request, allowQueryToken = false): string | null {
  const bearer = parseBearerToken(request.headers.get("authorization"))
  if (bearer) return bearer
  if (!allowQueryToken) return null
  return new URL(request.url).searchParams.get("token")
}

export async function authenticateRequest(
  request: Request,
  verifier: VerifyAccessTokenOptions,
  options?: { allowQueryToken?: boolean },
): Promise<AuthContext> {
  const token = requestToken(request, options?.allowQueryToken)
  if (!token) throw new Error("Missing bearer token")
  return verifyAccessToken(token, verifier)
}

export type AuthEnv<B extends object = Record<string, unknown>> = {
  Bindings: B
  Variables: AuthVariables
}

export type RequireAuthOptions<B extends object> = {
  verifier: VerifyAccessTokenOptions | ((context: Context<AuthEnv<B>>) => VerifyAccessTokenOptions)
  allowQueryToken?: boolean
  ensureUser?: (auth: AuthContext, context: Context<AuthEnv<B>>) => void | Promise<void>
  onUnauthorized?: (context: Context<AuthEnv<B>>, error: unknown) => Response | Promise<Response>
}

export function requireAuth<B extends object>(options: RequireAuthOptions<B>): MiddlewareHandler<AuthEnv<B>> {
  return async (context, next) => {
    try {
      const verifier = typeof options.verifier === "function" ? options.verifier(context) : options.verifier
      const auth = await authenticateRequest(context.req.raw, verifier, {
        allowQueryToken: options.allowQueryToken,
      })
      await options.ensureUser?.(auth, context)
      context.set("auth", auth)
      await next()
    } catch (error) {
      if (options.onUnauthorized) return options.onUnauthorized(context, error)
      return context.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or missing authentication token",
          },
        },
        401,
      )
    }
  }
}
