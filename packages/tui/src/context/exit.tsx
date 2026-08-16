import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@nikcli-ai/util/cli-error"
import { restoreTerminalState } from "@nikcli-ai/util/win32"

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: {
    onExit?: () => Promise<void>
    onBeforeExit?: () => Promise<void>
    onRestart?: () => Promise<void>
  }) => {
    const renderer = useRenderer()
    let exiting = false
    let summary: (() => string | undefined) | undefined

    const writeSummary = () => {
      const text = summary?.()
      if (!text) return
      process.stdout.write(text + "\n")
    }

    const exit = async (reason?: any) => {
      if (exiting) return
      exiting = true

      let exitCode = reason ? 1 : 0
      const errors = reason ? [reason] : []

      try {
        await input.onBeforeExit?.()
      } catch (error) {
        errors.push(error)
        exitCode = 1
      }

      try {
        renderer.setTerminalTitle("")
        renderer.destroy()
        if (!reason) writeSummary()
        restoreTerminalState()
      } catch (error) {
        errors.push(error)
        exitCode = 1
      }

      try {
        await input.onExit?.()
      } catch (error) {
        errors.push(error)
        exitCode = 1
      }

      for (const error of errors) {
        const formatted = FormatError(error) ?? FormatUnknownError(error)
        if (formatted) {
          process.stderr.write(formatted + "\n")
        }
      }

      process.exit(exitCode)
    }

    const restart = async () => {
      if (exiting) return
      exiting = true

      try {
        await input.onBeforeExit?.()
      } catch {
        // best effort
      }

      try {
        renderer.setTerminalTitle("")
        renderer.destroy()
        restoreTerminalState()
      } catch {
        // best effort
      }

      try {
        await input.onExit?.()
      } catch {
        // best effort
      }

      await input.onRestart?.()
    }

    return {
      exit,
      restart,
      setSummary(fn: (() => string | undefined) | undefined) {
        summary = fn
      },
    }
  },
})
