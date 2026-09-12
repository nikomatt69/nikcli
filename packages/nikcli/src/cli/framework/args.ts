/**
 * The two argv facts effect does not hand a handler, which the command bodies
 * were written to expect.
 *
 * The bodies under `src/cli/cmd/**` read yargs' `args` object, which always
 * carried `_`, `$0` and — because nikcli set `parserConfiguration({"populate--":
 * true})` — a `--` array. `run` and `goal` append that array to their message,
 * so dropping it silently truncates what the user typed.
 *
 * Reconstructed from the real argv rather than threaded through the parser:
 * effect deliberately stops at `--`, and there is nothing to thread.
 */
export function passthrough(): string[] {
  const separator = process.argv.indexOf("--")
  return separator === -1 ? [] : process.argv.slice(separator + 1)
}
