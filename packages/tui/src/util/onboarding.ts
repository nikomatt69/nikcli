import type { UserSchema } from "@nikcli-ai/util/user-schema"

/**
 * Whether first-run onboarding produced an account.
 *
 * `DialogOnboarding.run` resolves the same way whether the user finished the
 * wizard or dismissed it, so the only evidence that onboarding worked is that
 * an account exists afterwards. That is why the caller re-checks rather than
 * trusting the dialog's resolution.
 */
export type OnboardingOutcome =
  | { readonly status: "complete"; readonly user: UserSchema.PublicUser }
  | { readonly status: "incomplete"; readonly attempts: number }

export type EnsureOnboardedInput = {
  /** Show the wizard. Resolves when it closes, however it closed. */
  readonly runOnboarding: () => Promise<void>
  /** The account as the server sees it, or null if there is none. */
  readonly currentUser: () => Promise<UserSchema.PublicUser | null>
  /** Consecutive wizard runs before the session is reported incomplete. */
  readonly maxAttempts?: number
  /** Called after each run that did not produce an account. */
  readonly onAttemptFailed?: (attempt: number) => void
}

const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Re-run onboarding until an account exists, then stop.
 *
 * Onboarding is not skippable: dismissing the wizard reopens it, because a
 * session with no account is not a usable one. But it cannot retry without
 * end either. This loop was previously unbounded and awaited inside the TUI's
 * `onMount`, so a server that could not provision — or a user pressing escape
 * — parked the whole startup continuation, not just the dialog: the config
 * load and renderer wiring after it never ran, and the app never finished
 * starting with nothing on screen to say why.
 *
 * Bounding it turns that into a reportable outcome. `incomplete` is not
 * permission to proceed as though signed in; it is the state the caller has to
 * surface.
 */
export async function ensureOnboarded(input: EnsureOnboardedInput): Promise<OnboardingOutcome> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer")
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await input.runOnboarding()
    const user = await input.currentUser()
    if (user) return { status: "complete", user }
    input.onAttemptFailed?.(attempt)
  }
  return { status: "incomplete", attempts: maxAttempts }
}
