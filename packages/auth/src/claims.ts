import type { JWTPayload } from "jose"
import z from "zod"

export const AuthClaims = z
  .object({
    iss: z.string().url(),
    sub: z.string().min(1),
    aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    email: z.string().email().optional(),
    client_id: z.string().min(1).optional(),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .passthrough()

export type AuthClaims = z.infer<typeof AuthClaims>

export type AuthContext = {
  accountID: string
  email?: string
  clientID?: string
  claims: AuthClaims & JWTPayload
}
