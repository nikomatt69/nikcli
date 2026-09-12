import { Flag, GlobalFlag } from "effect/unstable/cli"

/**
 * The flags every nikcli command accepts, declared once on the root.
 *
 * yargs carried these as root `.option()`s plus a `.middleware()` that turned
 * them into process state. They have to exist here before the effect CLI can be
 * the entrypoint: an undeclared `--auto` is a parse error, not an ignored flag,
 * so flipping the default without them would break every scripted invocation
 * that passes one.
 *
 * The *effects* of these flags live in `main-effect.ts`'s bootstrap rather than
 * in a handler, because they configure the process — logging, permission
 * defaults, the Island bridge — before any command runs.
 */
export const PrintLogs = GlobalFlag.setting("print-logs")({
  flag: Flag.boolean("print-logs").pipe(
    Flag.withDescription("print logs to stderr"),
    Flag.withDefault(false),
  ),
})

export const LogLevel = GlobalFlag.setting("nikcli-log-level")({
  flag: Flag.choice("log-level", ["DEBUG", "INFO", "WARN", "ERROR"]).pipe(
    Flag.withDescription("log level"),
    Flag.optional,
  ),
})

export const Island = GlobalFlag.setting("island")({
  flag: Flag.boolean("island").pipe(
    Flag.withDescription("enable the nikcli Island macOS companion app"),
    Flag.withDefault(false),
  ),
})

export const Auto = GlobalFlag.setting("auto")({
  flag: Flag.boolean("auto").pipe(
    Flag.withDescription("approve permission prompts automatically (explicit denials still apply)"),
    Flag.withDefault(false),
  ),
})

/**
 * Two aliases rather than one flag: `--yolo` is what people type, and
 * `--dangerously-skip-permissions` is what a script should say so the intent is
 * obvious in CI logs and shell history.
 */
export const Yolo = GlobalFlag.setting("yolo")({
  flag: Flag.boolean("yolo").pipe(Flag.withDescription("alias for --auto"), Flag.withDefault(false)),
})

export const DangerouslySkipPermissions = GlobalFlag.setting("dangerously-skip-permissions")({
  flag: Flag.boolean("dangerously-skip-permissions").pipe(
    Flag.withDescription("alias for --auto"),
    Flag.withDefault(false),
  ),
})

export const GlobalFlags = [PrintLogs, LogLevel, Island, Auto, Yolo, DangerouslySkipPermissions]
