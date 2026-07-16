export default function SignUpForm() {
  return (
    <section class="app-panel app-panel-pad">
      <p class="app-kicker">One account</p>
      <h1 class="mt-2 font-display text-2xl font-semibold text-terminal-text">Create your NikCLI account</h1>
      <p class="mt-3 text-sm leading-6 text-terminal-muted">
        Your account is created automatically after GitHub or email verification. No password is required.
      </p>
      <a class="app-button-primary mt-6 block w-full text-center" href="/api/auth/authorize">
        Continue to account creation
      </a>
    </section>
  )
}
