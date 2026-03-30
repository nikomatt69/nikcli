import type { Plugin } from "@nikcli-ai/plugin"

const DEFAULT_PATTERNS = [
  /rm\s+-[rf]{1,2}\s+[^\s]/i,
  /rm\s+--recursive/i,
  /git\s+reset\s+--hard/i,
  /git\s+push\s+(--force|-f)\b/i,
  /git\s+clean\s+-[fdx]+/i,
  /git\s+checkout\s+--\s+\./i,
  /DROP\s+TABLE/i,
  /TRUNCATE\s+TABLE/i,
  /chmod\s+-R\s+777/i,
  /\bkill\s+-9\b/i,
  /pkill\s+-[0-9]+/i,
  />\s*\/dev\/[a-z]+/i,
  /dd\s+if=/i,
  /mkfs\./i,
  /format\s+[a-z]:/i,
]

function isDestructive(text: string, extraPatterns: RegExp[], allowList: RegExp[]): boolean {
  if (allowList.some((p) => p.test(text))) return false
  return [...DEFAULT_PATTERNS, ...extraPatterns].some((p) => p.test(text))
}

/**
 * Safety Net
 *
 * Intercepts permission requests and tool executions that contain destructive
 * patterns and forces a confirmation prompt even when previously allowed.
 *
 * Options:
 *   extraPatterns — additional regex strings to flag as destructive
 *   allowList     — regex strings that mark a command as safe (override)
 */
export const SafetyNetPlugin: Plugin = async (_input, options) => {
  const extraPatterns = ((options?.extraPatterns as string[] | undefined) ?? []).map((p) => new RegExp(p, "i"))
  const allowList = ((options?.allowList as string[] | undefined) ?? []).map((p) => new RegExp(p, "i"))

  return {
    "permission.ask": async (permission, output) => {
      const { metadata } = permission
      const command =
        (metadata?.command as string | undefined) ??
        (metadata?.path as string | undefined) ??
        JSON.stringify(metadata)

      if (isDestructive(command, extraPatterns, allowList)) {
        // Force ask regardless of saved permission
        output.status = "ask"
      }
    },

    "tool.execute.before": async (toolInput, output) => {
      const { tool: toolName } = toolInput
      const args = output.args as Record<string, any>

      // Check bash / run commands
      if (toolName === "bash" || toolName === "run_command" || toolName === "execute_command") {
        const cmd: string = args.command ?? args.cmd ?? args.input ?? ""
        if (cmd && isDestructive(cmd, extraPatterns, allowList)) {
          // Prepend a visible warning so the model sees it in the tool output
          output.args = {
            ...args,
            command: `echo "[safety-net] WARNING: destructive pattern detected" && ${cmd}`,
          }
        }
      }

      // Check file operations on dangerous paths
      if (toolName === "write_file" || toolName === "patch_file" || toolName === "str_replace_editor") {
        const filePath: string = args.path ?? args.file_path ?? args.file ?? ""
        if (filePath && (filePath.includes("~") || filePath.startsWith("/"))) {
          const dangerous = ["/etc/", "/usr/", "/bin/", "/sbin/", "/boot/"]
          if (dangerous.some((d) => filePath.startsWith(d))) {
            output.args = { ...args, _safety_net_blocked: true, path: "/dev/null" }
          }
        }
      }
    },
  }
}

export default { server: SafetyNetPlugin }
