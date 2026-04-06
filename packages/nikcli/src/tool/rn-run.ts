import z from "zod"
import { Tool } from "./tool"
import { ReactNative } from "@/mobile/react-native"
import DESCRIPTION from "./rn-run.txt"

export const ReactNativeRunTool = Tool.define("rn_run", {
  description: DESCRIPTION,
  parameters: z.object({
    platform: z.enum(["ios", "android"]).describe("Target platform to run on"),
    device: z.string().optional().describe("Device name or ID to run on"),
    configuration: z.string().optional().describe("Build configuration (e.g., 'Debug', 'Release')"),
  }),
  async execute({ platform, device, configuration }, ctx) {
    if (!(await ReactNative.available())) {
      throw new Error("React Native CLI is not available. Ensure npx and Node.js are installed.")
    }

    await ctx.ask({
      permission: "react-native",
      patterns: [`react-native run-${platform}`],
      always: [`npx react-native run-${platform}`],
      metadata: { platform, device },
    })

    const output = await ReactNative.run({ platform, device, configuration, cwd: process.cwd() })

    return {
      title: `React Native app running on ${platform === "ios" ? "iOS Simulator" : "Android Emulator"}`,
      metadata: { platform, device: device ?? "default", success: true },
      output: `react-native run-${platform} completed successfully.${device ? `\nDevice: ${device}` : ""}\n${output}`,
    }
  },
})
