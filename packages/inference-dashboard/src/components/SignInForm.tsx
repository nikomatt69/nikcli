export default function SignInForm() {
  return (
    <section class="app-panel app-panel-pad">
      <p class="app-kicker">NikCLI Identity</p>
      <h1 class="mt-2 font-display text-2xl font-semibold text-terminal-text">Sign in securely</h1>
      <p class="mt-3 text-sm leading-6 text-terminal-muted">
        Continue with GitHub or an email verification code. This dashboard no longer stores passwords.
      </p>
      <a class="app-button-primary mt-6 block w-full text-center" href="/api/auth/authorize">
        Continue to sign in
      </a>
    </section>
  )
}
