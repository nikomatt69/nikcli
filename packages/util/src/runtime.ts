import { lazy } from "./lazy"

/**
 * Runtime-aware command selection.
 *
 * nikcli itself always executes under Bun, but the *commands it spawns* —
 * monitor processes and local MCP servers — historically defaulted to the
 * Node toolchain (`node` / `npm` / `npx`). Each of those boots a second,
 * separate runtime (its own V8 heap, GC and event loop) alongside nikcli,
 * which is what makes a workspace full of background monitors and MCP servers
 * pile up CPU. When a standalone `bun` is resolvable we route those spawns
 * through Bun (`bun` / `bunx`) so the runtime is reused; when only Node is
 * present we leave the original command untouched so it keeps working.
 */
export namespace Runtime {
  /** A standalone `bun` executable is resolvable on PATH. */
  export const hasBun = lazy(() => Bun.which("bun") !== null)

  /**
   * Rewrite the leading runner of a shell command string to its Bun
   * equivalent when Bun is available. Only the well-known JS runner prefixes
   * (`npx`, `node`, and `npm` / `yarn` / `pnpm` with a `run` / `exec` verb)
   * are touched; everything else — including `npm install` and arbitrary
   * binaries — is returned unchanged so behaviour is never altered.
   */
  export function preferBun(command: string): string {
    if (!hasBun()) return command
    const lead = command.match(/^\s*/)![0]
    const afterLead = command.slice(lead.length)
    const sp = afterLead.search(/\s/)
    const bin = sp === -1 ? afterLead : afterLead.slice(0, sp)
    const rest = sp === -1 ? "" : afterLead.slice(sp) // keeps original spacing
    const replace = (newBin: string, newRest: string = rest) => `${lead}${newBin}${newRest}`

    switch (bin) {
      case "node":
        return replace("bun")
      case "npx":
        // `bunx` installs on demand, so the npm `-y` / `--yes` flag is dropped.
        // The leading whitespace is captured and the trailing whitespace is consumed
        // so the new bin and the first argument stay separated by exactly one space
        // (e.g. `npx -y @mcp/server` → `bunx @mcp/server`, not `bunx@mcp/server`
        // or `bunx  @mcp/server`, both of which the shell reports as failures).
        return replace("bunx", rest.replace(/^(\s+)(?:-y|--yes)\b\s*/, "$1"))
      case "npm":
      case "yarn":
      case "pnpm": {
        const verb = rest.match(/^\s+(run|exec|dlx|x)\b/)
        if (!verb) return command // install/add/etc. stay on the original tool
        if (verb[1] === "run") return replace("bun")
        return replace("bunx", rest.slice(verb[0].length))
      }
      default:
        return command
    }
  }

  /**
   * Build a local command array (for spawned subprocesses such as MCP
   * servers) that prefers `bunx` over `npx` when Bun is available, dropping
   * the npm `-y` auto-confirm flag that `bunx` does not need.
   */
  export function npx(...args: string[]): string[] {
    if (!hasBun()) return ["npx", ...args]
    return ["bunx", ...args.filter((arg) => arg !== "-y" && arg !== "--yes")]
  }
}
