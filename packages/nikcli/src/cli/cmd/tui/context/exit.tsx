import { useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onExit?: () => Promise<void>; onBeforeExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let exiting = false
    return async (reason?: any) => {
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
  },
})
