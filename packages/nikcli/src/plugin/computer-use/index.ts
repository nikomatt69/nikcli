// Computer-Use Plugin Entry Point
// Registers computer-use tools for nikcli

import type { Hooks, PluginInput } from "@nikcli-ai/plugin"
import {
  ComputerUseScreenshotTool,
  ComputerUseClickTool,
  ComputerUseTypeTool,
  ComputerUseWaitTool,
  getComputerUseStatus,
} from "./tools"
import { stopBridge, resetState, ensureComputerUseSetup } from "./bridge"
import { Log } from "@/util/log"

const log = Log.create({ service: "computer-use.plugin" })

export const ComputerUsePluginId = "nikcli-computer-use"

// Export the plugin function for integration
// Tools are registered through the tool namespace
export async function ComputerUsePlugin(input: PluginInput): Promise<Hooks> {
  log.info("computer-use plugin initialized")

  return {
    // Tool registration happens through the tool namespace
    // These tools can be referenced by the system prompt or direct usage
    tool: {},

    async config(cfg) {
      log.debug("computer-use config loaded", cfg)
    },

    async event(input) {
      // Handle events if needed for computer-use
    },
  }
}

// Export tools for direct registration
export const ComputerUseTools = {
  screenshot: ComputerUseScreenshotTool,
  click: ComputerUseClickTool,
  type: ComputerUseTypeTool,
  wait: ComputerUseWaitTool,
}

// Export tools for direct use
export { ComputerUseScreenshotTool, ComputerUseClickTool, ComputerUseTypeTool, ComputerUseWaitTool }
export { getComputerUseStatus }

// Export bridge functions
export { ensureComputerUseSetup, stopBridge, resetState } from "./bridge"

// Export types
export type { ComputerUseDetails, PermissionStatus } from "./types"
