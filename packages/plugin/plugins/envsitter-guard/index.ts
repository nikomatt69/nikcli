import type { Plugin } from "@nikcli-ai/plugin"
import { basename } from "path"

const DEFAULT_PATTERNS = [".env", ".envrc", ".env.local", ".env.development", ".env.production", ".env.test"]

const DEFAULT_PATTERN_REGEXES = [/^\.env$/, /^\.env\..+$/, /^\.envrc$/, /\b\.env\b/]

function matchesEnvPattern(filePath: string, extra: RegExp[]): boolean {
  const base = basename(filePath)
  const allPatterns = [...DEFAULT_PATTERN_REGEXES, ...extra]
  return allPatterns.some((r) => r.test(base) || r.test(filePath))
}

const WATCHED_TOOLS = new Set([
  "read_file",
  "write_file",
  "edit",
  "edit_file",
  "patch_file",
  "str_replace_editor",
  "view",
  "cat",
  "open",
  "file_read",
  "file_write",
  "create_file",
])

function extractPath(args: Record<string, any>): string | undefined {
  return args.path ?? args.file_path ?? args.file ?? args.filename ?? args.target
}

/**
 * Envsitter Guard
 *
 * Prevents agents and tools from reading, writing, or editing sensitive
 * environment files (.env, .envrc, .env.*) without explicit opt-in.
 *
 * Options:
 *   patterns  — additional regex strings to match against file paths
 *   warnOnly  — if true, log the attempt but don't block (default: false)
 */
export const EnvsitterGuardPlugin: Plugin = async (_input, options) => {
  const extraPatterns = ((options?.patterns as string[] | undefined) ?? []).map((p) => new RegExp(p))
  const warnOnly = (options?.warnOnly as boolean | undefined) ?? false

  return {
    "tool.execute.before": async (toolInput, output) => {
      const { tool: toolName } = toolInput
      if (!WATCHED_TOOLS.has(toolName)) return

      const args = output.args as Record<string, any>
      const filePath = extractPath(args)
      if (!filePath) return

      if (matchesEnvPattern(filePath, extraPatterns)) {
        const msg = `[envsitter-guard] Access to "${filePath}" is blocked — this file may contain sensitive credentials.`

        if (warnOnly) {
          console.warn(msg)
          return
        }

        // Redirect to a path that won't exist so the tool returns a file-not-found error
        output.args = {
          ...args,
          path: undefined,
          file_path: "/dev/null/.envsitter_blocked",
          file: undefined,
          _envsitter_blocked: true,
          _envsitter_reason: msg,
        }
      }
    },
  }
}

export default { server: EnvsitterGuardPlugin }
