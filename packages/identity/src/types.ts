import type { ClientID } from "./constants"

export type Account = {
  id: string
  email: string
  created_at: number
  updated_at: number
  disabled_at: number | null
}

export type LoginIntent =
  | {
      kind: "authorize"
      clientID: ClientID
      redirectURI: string
      state: string
      scope: string
      codeChallenge: string
    }
  | { kind: "device"; userCode: string }

export type AuthCode = {
  accountID: string
  clientID: ClientID
  redirectURI: string
  scope: string
  codeChallenge: string
}

export type EmailChallenge = {
  email: string
  nonce: string
  codeHash: string
  attempts: number
}

export type DeviceCodeRow = {
  device_code_hash: string
  user_code: string
  client_id: ClientID
  scope: string
  status: "pending" | "approved" | "denied" | "consumed"
  account_id: string | null
  expires_at: number
  last_poll_at: number | null
  created_at: number
}

export type RefreshTokenRow = {
  id: string
  account_id: string
  token_hash: string
  client_id: ClientID
  family_id: string
  expires_at: number
  rotated_at: number | null
  revoked_at: number | null
  created_at: number
}

export type SigningKeyRow = {
  kid: string
  alg: "ES256"
  private_jwk: string
  public_jwk: string
  created_at: number
  retired_at: number | null
}
