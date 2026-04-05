import os from "os"
import { cmd } from "./cmd"
import { Tophat } from "@/mobile/tophat"
import { TophatDoctor } from "@/mobile/tophat-doctor"
import { MobileProjectDetect } from "@/mobile/project-detect"

export const MobileTophatCommand = cmd({
  command: "tophat",
  describe: "Shopify Tophat integration for mobile app development",
  builder: (yargs) =>
    yargs
      .command({
        command: "doctor",
        describe: "check Tophat and mobile development environment",
        handler: async () => {
          const report = await TophatDoctor.run()
          console.log(TophatDoctor.formatReport(report))
        },
      })
      .command({
        command: "status",
        describe: "show Tophat providers and connected devices",
        handler: async () => {
          const status = await Tophat.status()
          if (!status.available) {
            console.log("Tophat is not installed. Install from https://github.com/Shopify/tophat")
            return
          }
          console.log(`Tophat: ${status.cliPath}`)
          console.log(
            `Providers: ${status.providers.length > 0 ? status.providers.map((p) => p.id).join(", ") : "none"}`,
          )
          console.log(`Devices: ${status.devices.length}`)
          for (const device of status.devices) {
            console.log(`  - ${device.name} (${device.platform})`)
          }
        },
      })
      .command({
        command: "install <target>",
        describe: "install a mobile artifact via Tophat",
        builder: (yargs) =>
          yargs
            .positional("target", {
              type: "string",
              describe: "path to .ipa/.apk, or a public URL",
            })
            .option("platform", {
              type: "string",
              choices: ["ios", "android"] as const,
              describe: "target platform",
            })
            .option("destination", {
              type: "string",
              choices: ["device", "simulator", "emulator"] as const,
              describe: "install destination",
            }),
        handler: async (args) => {
          const target = String(args.target)
          if (!(await Tophat.available())) {
            throw new Error("tophatctl is not installed. Install from https://github.com/Shopify/tophat")
          }
          const isUrl = target.startsWith("http://") || target.startsWith("https://")
          await Tophat.install({
            ...(isUrl ? { url: target } : { path: target }),
            platform: args.platform as string | undefined,
            destination: args.destination as string | undefined,
          })
          console.log(`Installed: ${target}`)
        },
      })
      .command({
        command: "open",
        describe: "open Tophat app",
        handler: async () => {
          if (os.platform() !== "darwin") {
            throw new Error("Tophat is only available on macOS")
          }
          const bin = await Tophat.cliPath()
          if (!bin) {
            throw new Error("tophatctl is not installed")
          }
          const proc = Bun.spawn(["open", "-a", "Tophat"], {
            stdout: "pipe",
            stderr: "pipe",
          })
          await proc.exited
          console.log("Opened Tophat")
        },
      })
      .command({
        command: "link <url>",
        describe: "generate Tophat install URL from a public artifact URL",
        builder: (yargs) =>
          yargs
            .positional("url", {
              type: "string",
              describe: "public URL to the artifact (.ipa, .apk, .zip)",
            })
            .option("platform", {
              type: "string",
              choices: ["ios", "android"] as const,
              describe: "target platform hint",
            }),
        handler: async (args) => {
          const url = String(args.url)
          const deepLink = Tophat.installUrl(url, { platform: args.platform as string | undefined })
          const localUrl = Tophat.localInstallUrl(url, { platform: args.platform as string | undefined })
          console.log("")
          console.log(`Deep link:  ${deepLink}`)
          console.log(`Local link:  ${localUrl}`)
          console.log("")
          console.log("Use the deep link (tophat://) in markdown/HTML that supports custom schemes.")
          console.log("Use the local link (http://localhost:29070) in GitHub PRs or sites that block custom schemes.")
        },
      })
      .command({
        command: "quick-launch",
        describe: "sync Tophat Quick Launch entries for the current project",
        builder: (yargs) =>
          yargs
            .option("name", {
              type: "string",
              describe: "app name for Quick Launch entry",
            })
            .option("url", {
              type: "string",
              describe: "public artifact URL",
            }),
        handler: async (args) => {
          if (!(await Tophat.available())) {
            throw new Error("tophatctl is not installed")
          }
          const name = String(args.name || "dev")
          const url = String(args.url || "")
          if (!url) {
            console.log("Usage: nikcli mobile tophat quick-launch --name <app> --url <artifact-url>")
            return
          }
          await Tophat.syncQuickLaunch([
            {
              id: "nikcli-dev",
              name,
              recipes: [
                {
                  artifactProviderID: "http",
                  artifactProviderParameters: { url },
                },
              ],
            },
          ])
          console.log(`Synced Quick Launch: ${name}`)
        },
      })
      .command({
        command: "detect",
        describe: "detect mobile project type in the current directory",
        handler: async () => {
          const detected = await MobileProjectDetect.detect(process.cwd())
          if (!detected) {
            console.log("No mobile project detected in the current directory.")
            return
          }
          const cwd = process.cwd()
          console.log("")
          console.log(`Type:        ${detected.primaryPlatform}`)
          console.log(`Method:      ${detected.method}`)
          console.log(`Platforms:   ${detected.platforms.join(", ")}`)
          if (detected.root !== cwd) {
            console.log(`Root:        ${detected.root}`)
          }
          console.log("")
          console.log("Build configs:")
          for (const [platform, config] of Object.entries(detected.buildConfigs)) {
            console.log(`  ${platform}: ${config.command.join(" ")}`)
            if (config.artifactPatterns?.length) {
              console.log(`    artifacts: ${config.artifactPatterns.join(", ")}`)
            }
          }
          console.log("")
        },
      })
      .demandCommand(),
  async handler() {},
})
