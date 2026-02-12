import type { MiddlewareHandler } from "hono"
import { createRemoteJWKSet, jwtVerify } from "jose"
import type { JWTPayload } from "jose"
import { ensureUser } from "./db"
import type { AuthContext, CloudBindings, CloudEnv } from "./types"

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getRemoteJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(url)
  if (cached) return cached

  const created = createRemoteJWKSet(new URL(url))
  jwksCache.set(url, created)
  return created
}

function parseBearerToken(value?: string | null): string | null {
  if (!value) return null
  const [kind, token] = value.split(" ")
  if (kind?.toLowerCase() !== "bearer") return null
  if (!token) return null
  return token
}

export async function verifyAuthToken(token: string, env: CloudBindings): Promise<AuthContext> {
  const issuer = env.AUTH_ISSUER
  const audience = env.AUTH_AUDIENCE

  let payload: JWTPayload
  if (env.AUTH_JWKS_URL) {
    const jwks = getRemoteJwks(env.AUTH_JWKS_URL)
    const verified = await jwtVerify(token, jwks, {
      algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "EdDSA"],
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
    })
    payload = verified.payload
  } else if (env.AUTH_JWT_SECRET) {
    const secret = new TextEncoder().encode(env.AUTH_JWT_SECRET)
    const verified = await jwtVerify(token, secret, {
      algorithms: ["HS256", "HS384", "HS512"],
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
    })
    payload = verified.payload
  } else {
    throw new Error("Missing auth verifier configuration")
  }

  const userID = typeof payload.sub === "string" ? payload.sub : ""
  if (!userID) {
    throw new Error("Missing subject claim in auth token")
  }

  return {
    userID,
    email: typeof payload.email === "string" ? payload.email : undefined,
    token,
    claims: payload,
  }
}

export async function authenticateRequest(
  request: Request,
  env: CloudBindings,
  options?: { allowQueryToken?: boolean },
): Promise<AuthContext> {
  const requestURL = new URL(request.url)
  const queryToken = options?.allowQueryToken ? requestURL.searchParams.get("token") : null
  const authToken = parseBearerToken(request.headers.get("authorization"))
  const token = authToken ?? queryToken

  if (!token) {
    throw new Error("Missing bearer token")
  }

  return verifyAuthToken(token, env)
}

export const requireAuth: MiddlewareHandler<CloudEnv> = async (c, next) => {
  try {
    const auth = await authenticateRequest(c.req.raw, c.env, { allowQueryToken: false })
    await ensureUser(c.env.DB, auth)
    c.set("auth", auth)
    await next()
  } catch {
    return c.json(
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
