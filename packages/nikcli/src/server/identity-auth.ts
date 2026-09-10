import { verifyAccessToken, type VerifyAccessTokenOptions } from "@nikcli-ai/auth"
import { Flag } from "@nikcli-ai/util/flag"
import { UserDB } from "@/user/users"

const DEFAULT_ISSUER = "https://auth.nikcli.store"

/**
 * The server is the single trust boundary in
 * `specs/effect-tui/12-identity-onboarding-auth.md`: it verifies the issuer JWT
 * and the TUI/SDK/CLI consume its typed answers rather than re-validating the
 * signature themselves. That spec turns login/refresh/expiry/revocation into
 * one state machine on top of this verifier; it does not replace it.
 */
export function identityVerifierOptions(): VerifyAccessTokenOptions | undefined {
  // Default-on: every nikcli server accepts issuer JWTs. Verification is
  // lazy — the JWKS is only fetched when a JWT-shaped bearer arrives, so
  // offline/local servers with no OAuth clients never touch the network.
  // Set NIKCLI_AUTH_ISSUER=off (or 0/false) to disable entirely.
  const raw = Flag.NIKCLI_AUTH_ISSUER?.trim()
  if (raw && ["off", "0", "false", "none"].includes(raw.toLowerCase())) return
  const issuer = raw || DEFAULT_ISSUER
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
