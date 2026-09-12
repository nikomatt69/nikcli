import { Schema } from "effect"
import { zod } from "@nikcli-ai/util/effect-zod"

/**
 * The auth lifecycle as data.
 *
 * `specs/effect-tui/12-identity-onboarding-auth.md` requirement 1: the server
 * and the TUI have to agree on the same legal transitions, which means the
 * transitions have to be something both can read rather than control flow each
 * side reimplements. A state machine scattered across `if` statements cannot be
 * tested for the transitions it forbids — only for the ones somebody thought to
 * exercise.
 *
 * This is the contract. Nothing drives it yet: the flows that will move through
 * these states (device code, PKCE callback, passkey challenge, refresh) each
 * land as their own slice, and each one is a matter of calling `transition`
 * instead of assigning a field.
 *
 * Follows the shape EOT-09 already landed for background runs
 * (`src/background/run.ts`): a terminal-state predicate plus a `canTransition`
 * that callers check before mutating.
 */
export namespace AuthState {
  const NameSchema = Schema.Literals([
    "Anonymous",
    "VerifyingEmail",
    "AwaitingDeviceCode",
    "AwaitingPasskeyChallenge",
    "AwaitingOAuthCallback",
    "Authenticated",
    "Refreshing",
    "Expired",
    "Revoked",
  ]).annotate({ identifier: "AuthStateName" })
  export const Name = zod(NameSchema)
  export type Name = Schema.Schema.Type<typeof NameSchema>

  /**
   * States a session cannot leave on its own.
   *
   * `Revoked` is terminal because the server withdrew the grant: the only way
   * forward is a new sign-in, which starts from `Anonymous` rather than
   * resuming this state. `Expired` is deliberately **not** terminal — an
   * expired access token is the normal precondition for a refresh, and treating
   * it as terminal would force a full re-auth on every token lifetime.
   */
  const TERMINAL: ReadonlySet<Name> = new Set<Name>(["Revoked"])

  export function isTerminal(state: Name): boolean {
    return TERMINAL.has(state)
  }

  /**
   * Every legal move, by source state.
   *
   * Written as a table rather than a predicate so the illegal moves are
   * enumerable: a test can assert that `Anonymous -> Authenticated` is refused
   * without knowing why, and adding a flow means adding a row here rather than
   * finding every branch that guards a transition.
   */
  const LEGAL: Readonly<Record<Name, readonly Name[]>> = {
    // A sign-in begins by choosing a flow. Reaching `Authenticated` directly
    // would mean a credential arrived without one, which is the shape of every
    // forbidden grant in requirement 2.
    Anonymous: ["VerifyingEmail", "AwaitingDeviceCode", "AwaitingPasskeyChallenge", "AwaitingOAuthCallback"],
    // Each in-flight flow either completes, is abandoned back to Anonymous, or
    // is refused by the provider. `Revoked` covers access_denied.
    VerifyingEmail: ["Authenticated", "Anonymous", "Revoked"],
    AwaitingDeviceCode: ["Authenticated", "Anonymous", "Expired", "Revoked"],
    AwaitingPasskeyChallenge: ["Authenticated", "Anonymous", "Revoked"],
    AwaitingOAuthCallback: ["Authenticated", "Anonymous", "Expired", "Revoked"],
    // A live session ages out, refreshes, or is withdrawn. It never returns to
    // a flow state: re-running a flow starts from Anonymous.
    Authenticated: ["Refreshing", "Expired", "Revoked", "Anonymous"],
    // Refresh rotates the token, finds the grant gone, or finds it invalid.
    Refreshing: ["Authenticated", "Expired", "Revoked"],
    // Expiry is recoverable by refresh, and abandonable.
    Expired: ["Refreshing", "Anonymous", "Revoked"],
    Revoked: [],
  }

  export class IllegalTransition extends Schema.TaggedError<IllegalTransition>()("AuthIllegalTransition", {
    from: NameSchema,
    to: NameSchema,
  }) {
    override get message() {
      return `Auth state cannot move from ${this.from} to ${this.to}`
    }
  }

  /**
   * Whether the move is legal.
   *
   * A state is never legal as its own successor: re-entering a state is either
   * a no-op the caller should not have attempted, or a distinct event the table
   * has no name for. Both are worth a failed check rather than a silent pass.
   */
  export function canTransition(from: Name, to: Name): boolean {
    return LEGAL[from].includes(to)
  }

  /** The legal successors of a state, for tests, audits, and UI affordances. */
  export function successors(from: Name): readonly Name[] {
    return LEGAL[from]
  }

  /**
   * Move, or fail with the pair that was refused.
   *
   * Returns the typed error rather than throwing so callers on the Effect side
   * can `yield*` it and callers on the Promise side can branch, without either
   * needing a try/catch around a state assignment.
   */
  export function transition(from: Name, to: Name): Name | IllegalTransition {
    if (!canTransition(from, to)) return new IllegalTransition({ from, to })
    return to
  }
}
