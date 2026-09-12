/**
 * Process entry — loads the full CLI.
 *
 * Daemon hosting for the compiled binary is handled in-process by
 * `ensureDaemon` (see `@nikcli-ai/browser-control/daemon-client`): there is no
 * on-disk `daemon.ts` under `/$bunfs`, and re-execing this binary just to bind
 * a Unix socket is killed by the OS (SIGKILL on a ~280MB image).
 */
import "./util/document-shim"

// `NIKCLI_CLI=effect` selects the `effect/unstable/cli` entrypoint while the
// command tree is migrated off yargs a batch at a time. Both are dynamic, so
// choosing one never loads the other. See `src/cli/main-effect.ts`.
if (process.env.NIKCLI_CLI === "effect") {
  const { runEffectCli } = await import("./cli/main-effect")
  runEffectCli()
} else {
  const { runCli } = await import("./cli-main")
  await runCli()
}
