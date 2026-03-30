import type { Plugin } from "@nikcli-ai/plugin"
import { tool } from "@nikcli-ai/plugin"
import { existsSync } from "fs"
import { join } from "path"

type DirenvEntry = {
  directory: string
  loadedVars: Record<string, string>
  loadedAt: number
}

let lastLoad: DirenvEntry | null = null

async function loadDirenv(shell: any, directory: string): Promise<Record<string, string>> {
  const envrcPath = join(directory, ".envrc")
  if (!existsSync(envrcPath)) return {}

  try {
    const result = await shell`direnv export json`.cwd(directory).quiet().nothrow()
    if (result.exitCode !== 0) return {}
    const text = result.text("utf8").trim()
    if (!text) return {}
    return JSON.parse(text) as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * Direnv
 *
 * Automatically loads direnv environment variables at session start.
 * Runs `direnv export json` in the project directory and injects the
 * variables into process.env for the current session.
 *
 * Silently skips if direnv is not installed or no .envrc is present.
 */
export const DirenvPlugin: Plugin = async (input) => {
  const { directory, $ } = input

  // Load on startup
  const initialVars = await loadDirenv($, directory)
  if (Object.keys(initialVars).length > 0) {
    Object.assign(process.env, initialVars)
    lastLoad = { directory, loadedVars: initialVars, loadedAt: Date.now() }
  }

  return {
    event: async ({ event }) => {
      // Reload on session create to pick up any .envrc changes
      if ((event as any).type === "session.created") {
        const vars = await loadDirenv($, directory)
        if (Object.keys(vars).length > 0) {
          Object.assign(process.env, vars)
          lastLoad = { directory, loadedVars: vars, loadedAt: Date.now() }
        }
      }
    },

    tool: {
      direnv_reload: tool({
        description: "Re-run direnv export and reload environment variables from .envrc",
        args: {},
        async execute() {
          const vars = await loadDirenv($, directory)
          if (Object.keys(vars).length === 0) {
            const envrcPath = join(directory, ".envrc")
            if (!existsSync(envrcPath)) {
              return `No .envrc found in ${directory}`
            }
            return `direnv export returned no variables. Is direnv installed and the .envrc allowed?`
          }

          Object.assign(process.env, vars)
          lastLoad = { directory, loadedVars: vars, loadedAt: Date.now() }

          return `Reloaded ${Object.keys(vars).length} environment variable(s) from .envrc:\n${Object.keys(vars).join(", ")}`
        },
      }),

      direnv_status: tool({
        description: "Show the current direnv status: which variables are loaded and from where",
        args: {},
        async execute() {
          const envrcPath = join(directory, ".envrc")

          if (!existsSync(envrcPath)) {
            return `No .envrc found in ${directory}\ndirenv is not active for this project.`
          }

          if (!lastLoad) {
            return `Found .envrc at ${envrcPath} but no variables have been loaded yet.\nRun direnv_reload to load them.`
          }

          const elapsed = Math.floor((Date.now() - lastLoad.loadedAt) / 1000)
          const varList = Object.entries(lastLoad.loadedVars)
            .map(([k, v]) => `  ${k}=${v.length > 40 ? v.slice(0, 40) + "..." : v}`)
            .join("\n")

          return [
            `direnv status for ${directory}`,
            `  .envrc:     ${envrcPath}`,
            `  Loaded:     ${elapsed}s ago`,
            `  Variables:  ${varList.length === 0 ? "none" : ""}`,
            varList,
          ]
            .filter(Boolean)
            .join("\n")
        },
      }),
    },
  }
}

export default { server: DirenvPlugin }
