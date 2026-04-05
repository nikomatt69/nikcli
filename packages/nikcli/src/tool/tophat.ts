import z from "zod"
import { Tool } from "./tool"
import { Tophat } from "@/mobile/tophat"
import DESCRIPTION from "./tophat.txt"

export const TophatInstallTool = Tool.define("tophat_install", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().optional().describe("Local file path to .ipa, .apk, or .zip artifact"),
    url: z.string().url().optional().describe("Public URL to download the artifact"),
    platform: z.enum(["ios", "android"]).optional().describe("Target platform"),
    destination: z.enum(["device", "simulator", "emulator"]).optional().describe("Install destination"),
  }),
  async execute({ path, url, platform, destination }, ctx) {
    if (!path && !url) {
      throw new Error("Provide either 'path' (local file) or 'url' (public URL)")
    }
    if (path && url) {
      throw new Error("Provide either 'path' or 'url', not both")
    }

    if (!(await Tophat.available())) {
      throw new Error("Tophat is not installed. Install it from https://github.com/Shopify/tophat (macOS 15+ required)")
    }

    const target = path ?? url ?? ""

    await ctx.ask({
      permission: "tophat",
      patterns: [target],
      always: ["*"],
      metadata: { platform, destination },
    })

    await Tophat.install({
      path,
      url,
      platform,
      destination,
    })

    return {
      title: `Installed ${platform ? `(${platform}) ` : ""}${target}`,
      metadata: { platform: platform ?? "unknown", destination: destination ?? "default", success: true },
      output: `Installed artifact via Tophat: ${target}${platform ? ` [${platform}]` : ""}${destination ? ` -> ${destination}` : ""}`,
    }
  },
})
