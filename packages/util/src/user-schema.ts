/**
 * The account shape both sides of `/user/*` agree on.
 *
 * `/user/*` is outside the declared OpenAPI surface — the legacy error bodies
 * cannot round-trip through the `HttpApi` error encoder — so there is no
 * generated type for a caller to import. Without one definition here, the
 * terminal either keeps importing `UserDB` for a type (pinning it to the
 * server's module graph, which `specs/tui-package.md` §2 removed elsewhere) or
 * hand-copies the fields and drifts, exactly as `MobileAuth.PublicToken` did.
 *
 * The public shape is the shared one; the server's `User` adds the secret.
 */
export namespace UserSchema {
  export type Role = "admin" | "user"

  export type PublicUser = {
    id: string
    username: string
    email: string
    display_name: string | null
    role: Role
    created_at: number
    updated_at: number
  }

  /** The two counters `GET /user/me/stats` returns. */
  export type Stats = {
    contacts: number
    unread: number
  }
}
