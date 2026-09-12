import { Effect } from "effect"
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Commands } from "./commands"
import { Handlers } from "./handlers.generated"
import { Runtime } from "./framework/runtime"
import { Installation } from "@/installation"

/**
 * The `effect/unstable/cli` entrypoint, running alongside the yargs one.
 *
 * A second entrypoint rather than a replacement: the yargs CLI in `cli-main.ts`
 * is what every user and every test runs, and it keeps working untouched while
 * the command tree is migrated a batch at a time. `NIKCLI_CLI=effect` selects
 * this one. When all ~44 commands have moved and the parity harness is green
 * across them, this becomes the entrypoint and `cli-main.ts` goes away.
 *
 * Every handler is a `() => import()`, the default command included — the one
 * structural thing the yargs side cannot do, since yargs needs the default
 * command's module to build its parser.
 *
 * `commands.ts` and `handlers.generated.ts` are generated from the yargs
 * declarations and held to them by `test/cli/effect-cli-parity.test.ts`.
 *
 * See `specs/background-service.md` for the thin-client argument this serves.
 */

export function runEffectCli(): void {
  // `runMain`, not `runPromise`: it is what renders a parse error as CLI output
  // and sets the exit code. With `runPromise` a missing required argument
  // surfaces as an unhandled rejection and Bun prints a stack trace at the user.
  BunRuntime.runMain(
    Runtime.run(Commands, Handlers, { version: Installation.VERSION }).pipe(
      Effect.provide(BunServices.layer),
    ) as Effect.Effect<void, unknown, never>,
  )
}
