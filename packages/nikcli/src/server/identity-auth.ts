import { verifyAccessToken, type VerifyAccessTokenOptions } from "@nikcli-ai/auth"
import { Flag } from "@/flag/flag"
import { UserDB } from "@/user/users"

export function identityVerifierOptions(): VerifyAccessTokenOptions | undefined {
  const issuer = Flag.NIKCLI_AUTH_ISSUER
  if (!issuer) return
  const jwksUrl = Flag.NIKCLI_AUTH_JWKS_URL ?? new URL("/.well-known/jwks.json", issuer).toString()
  return {
    issuer,
    audience: Flag.NIKCLI_AUTH_AUDIENCE,
    jwksUrl: Flag.NIKCLI_AUTH_JWT_SECRET ? undefined : jwksUrl,
    jwtSecret: Flag.NIKCLI_AUTH_JWT_SECRET,
  }
}

export async function externalSessionForToken(
  token: string,
): Promise<{ user: UserDB.PublicUser; token: string } | undefined> {
  const verifier = identityVerifierOptions()
  if (!verifier) return
  const auth = await verifyAccessToken(token, verifier)
  if (!auth.email) throw new Error("Identity token is missing the verified email claim")
  return {
    user: UserDB.ensureExternalUser({ sub: auth.accountID, email: auth.email }),
    token,
  }
}
