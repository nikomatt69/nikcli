import "@opentui/solid/preload"
import { afterAll } from "bun:test"
import os from "os"

// Set GIT_CEILING_DIRECTORIES to temp directory root to stop Git from resolving parent repo (C:\Users\Utente\.git)
process.env.GIT_CEILING_DIRECTORIES = os.tmpdir()

// Capture a copy of the original environment keys/values when this file loads
const originalEnv = { ...process.env }

afterAll(() => {
  // Restore mutated env vars and delete any newly added ones (like NIKCLI_TEST_HOME, XDG_*, etc.)
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
  // Ensure any keys from originalEnv that were deleted are restored
  for (const key of Object.keys(originalEnv)) {
    if (!(key in process.env)) {
      process.env[key] = originalEnv[key]
    }
  }
})
