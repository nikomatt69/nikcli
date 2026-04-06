import z from "zod"
import { Tool } from "./tool"
import { Expo } from "@/mobile/expo"
import DESCRIPTION from "./expo.txt"

export const ExpoTool = Tool.define("expo", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["start", "build", "install", "publish", "profiles", "doctor"]).describe("Expo action to perform"),
    platform: z.enum(["ios", "android", "web", "all"]).optional().describe("Target platform"),
    profile: z.string().optional().describe("EAS build profile name"),
    clear: z.boolean().optional().describe("Clear cache"),
    port: z.number().optional().describe("Metro port (default: 8081)"),
    packages: z.array(z.string()).optional().describe("Packages to install"),
    message: z.string().optional().describe("Publish message"),
  }),
  async execute(p, ctx) {
    const cwd = process.cwd()
    switch (p.action) {
      case "start": {
        await ctx.ask({
          permission: "expo",
          patterns: ["expo start"],
          always: ["npx expo start"],
          metadata: { platform: p.platform },
        })
        const r = await Expo.start({
          platform: p.platform as "ios" | "android" | "web" | undefined,
          clear: p.clear,
          port: p.port,
          cwd,
        })
        return {
          title: `Expo dev server started`,
          metadata: { url: r.url, pid: r.pid, platform: p.platform ?? "all" } as Record<string, unknown>,
          output: `Metro bundler at ${r.url}\nPID: ${r.pid}`,
        }
      }
      case "build": {
        const pl = (p.platform ?? "all") as "ios" | "android" | "all"
        await ctx.ask({
          permission: "expo",
          patterns: [`eas build --platform ${pl}`],
          always: [`npx eas build --platform ${pl}`],
          metadata: { platform: pl },
        })
        const o = await Expo.build({ platform: pl, profile: p.profile, clearCache: p.clear, cwd })
        return {
          title: `EAS build for ${pl}`,
          metadata: { platform: pl, profile: p.profile ?? "default" } as Record<string, unknown>,
          output: o,
        }
      }
      case "install": {
        const pkgs = p.packages ?? []
        if (!pkgs.length) throw new Error("--packages required")
        await ctx.ask({
          permission: "expo",
          patterns: pkgs,
          always: [`npx expo install ${pkgs.join(" ")}`],
          metadata: { packages: pkgs },
        })
        const o = await Expo.installPackages(pkgs, { cwd })
        return {
          title: `Installed ${pkgs.length} package(s)`,
          metadata: { packages: pkgs } as Record<string, unknown>,
          output: o,
        }
      }
      case "publish": {
        await ctx.ask({
          permission: "expo",
          patterns: ["expo publish"],
          always: ["npx expo publish"],
          metadata: { message: p.message },
        })
        const o = await Expo.publish({ message: p.message, cwd })
        return {
          title: "OTA published",
          metadata: { message: p.message ?? "none" } as Record<string, unknown>,
          output: o,
        }
      }
      case "profiles": {
        const pr = await Expo.listProfiles({ cwd })
        return {
          title: pr.length ? `${pr.length} profile(s)` : "No profiles",
          metadata: { profiles: pr } as Record<string, unknown>,
          output: pr.length ? pr.map((x) => `  - ${x}`).join("\n") : "Configure eas.json",
        }
      }
      case "doctor": {
        const r = await Expo.doctor({ cwd })
        return {
          title: r.expoCli && r.easCli ? "Ready" : "Missing tools",
          metadata: { expo: r.expoCli, eas: r.easCli, node: r.nodeVersion } as Record<string, unknown>,
          output: r.details.map((d) => `  ${d.includes("not") ? "[-]" : "[+]"} ${d}`).join("\n"),
        }
      }
      default:
        throw new Error(`Unknown action: ${p.action}`)
    }
  },
})
