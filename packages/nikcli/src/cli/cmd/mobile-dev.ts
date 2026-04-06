import { cmd } from "./cmd"
import { MobileTophatCommand } from "./mobile-tophat"
import { Expo } from "@/mobile/expo"
import { Simulator } from "@/mobile/simulator"
import { ReactNative } from "@/mobile/react-native"

export const MobileDevCommand = cmd({
  command: "dev",
  describe: "Expo, simulator, and React Native development tools",
  builder: (yargs) =>
    yargs
      .command({
        command: "expo <action>",
        describe: "Expo and EAS Build management",
        builder: (yargs) =>
          yargs
            .positional("action", {
              type: "string",
              choices: ["start", "build", "install", "publish", "profiles", "doctor"] as const,
              describe: "Expo action to perform",
            })
            .option("platform", {
              type: "string",
              choices: ["ios", "android", "web", "all"] as const,
              describe: "Target platform",
            })
            .option("profile", {
              type: "string",
              describe: "EAS build profile name",
            })
            .option("clear", {
              type: "boolean",
              default: false,
              describe: "Clear cache before action",
            })
            .option("port", {
              type: "number",
              describe: "Metro bundler port (default: 8081)",
            })
            .option("packages", {
              type: "string",
              array: true,
              describe: "Package names to install (for 'install' action)",
            })
            .option("message", {
              type: "string",
              describe: "Publish message (for 'publish' action)",
            }),
        handler: async (args) => {
          const action = args.action as string
          const cwd = process.cwd()

          switch (action) {
            case "start": {
              const platform = args.platform as "ios" | "android" | "web" | undefined
              console.log(`Starting Expo dev server${platform ? ` for ${platform}` : ""}...`)
              const result = await Expo.start({ platform, clear: args.clear, port: args.port, cwd })
              console.log(`Expo dev server running at ${result.url}`)
              console.log(`Metro bundler PID: ${result.pid}`)
              break
            }
            case "build": {
              const platform = (args.platform ?? "all") as "ios" | "android" | "all"
              console.log(`Starting EAS build for ${platform}${args.profile ? ` (profile: ${args.profile})` : ""}...`)
              const output = await Expo.build({ platform, profile: args.profile, clearCache: args.clear, cwd })
              console.log(output)
              break
            }
            case "install": {
              const packages = (args.packages as string[] | undefined) ?? []
              if (packages.length === 0) {
                console.log("Error: --packages is required for install action")
                console.log("Example: nikcli mobile dev expo install --packages expo-camera expo-media-library")
                process.exit(1)
              }
              console.log(`Installing packages: ${packages.join(", ")}...`)
              const output = await Expo.installPackages(packages, { cwd })
              console.log(output)
              break
            }
            case "publish": {
              console.log("Publishing OTA update...")
              const output = await Expo.publish({ message: args.message, cwd })
              console.log(output)
              break
            }
            case "profiles": {
              const profiles = await Expo.listProfiles({ cwd })
              if (profiles.length === 0) {
                console.log("No build profiles found. Configure eas.json to add profiles.")
              } else {
                console.log("EAS Build Profiles:")
                for (const p of profiles) {
                  console.log(`  - ${p}`)
                }
              }
              break
            }
            case "doctor": {
              console.log("Running Expo environment checks...\n")
              const report = await Expo.doctor({ cwd })
              for (const detail of report.details) {
                const status = detail.includes("not") ? "-" : "+"
                console.log(`  [${status}] ${detail}`)
              }
              console.log("")
              if (report.expoCli && report.easCli) {
                console.log("Expo environment is ready.")
              } else {
                console.log("Some tools are missing. Install missing dependencies.")
              }
              break
            }
          }
        },
      })
      .command({
        command: "simulator <action>",
        describe: "iOS Simulator and Android Emulator management",
        builder: (yargs) =>
          yargs
            .positional("action", {
              type: "string",
              choices: [
                "list",
                "boot",
                "shutdown",
                "install",
                "screenshot",
                "logs",
                "wipe",
                "open",
                "touch",
                "swipe",
                "type",
                "launch",
                "openurl",
                "key",
                "focus",
                "click_label",
                "type_text",
                "press_key",
                "command_key",
                "accessibility_tree",
                "window_bounds",
                "wait_booted",
                "diagnostics",
              ] as const,
              describe: "Simulator action to perform",
            })
            .option("platform", {
              type: "string",
              choices: ["ios", "android"] as const,
              describe: "Target platform",
            })
            .option("device", {
              type: "string",
              describe: "Device ID or AVD name",
            })
            .option("path", {
              type: "string",
              describe: "File path to .ipa/.apk or other artifact",
            })
            .option("url", {
              type: "string",
              describe: "URL to download artifact from",
            })
            .option("output", {
              type: "string",
              describe: "Output file path for screenshot",
            })
            .option("filter", {
              type: "string",
              describe: "Filter pattern for logs",
            })
            .option("lines", {
              type: "number",
              default: 100,
              describe: "Number of log lines",
            })
            .option("label", {
              type: "string",
              describe: "Accessibility label for click_label action",
            })
            .option("text", {
              type: "string",
              describe: "Text to type for type_text action",
            })
            .option("key", {
              type: "string",
              describe: "Key name for press_key/command_key (e.g., a, return, escape)",
            })
            .option("modifiers", {
              type: "string",
              array: true,
              describe: "Key modifiers (command, shift, option, control)",
            })
            .option("timeout-ms", {
              type: "number",
              default: 30000,
              describe: "Timeout in ms for wait_booted",
            })
            .option("x", {
              type: "number",
              describe: "X coordinate for touch action",
            })
            .option("y", {
              type: "number",
              describe: "Y coordinate for touch action",
            })
            .option("x1", {
              type: "number",
              describe: "Start X coordinate for swipe action",
            })
            .option("y1", {
              type: "number",
              describe: "Start Y coordinate for swipe action",
            })
            .option("x2", {
              type: "number",
              describe: "End X coordinate for swipe action",
            })
            .option("y2", {
              type: "number",
              describe: "End Y coordinate for swipe action",
            }),
        handler: async (args) => {
          const action = args.action as string
          const platform = args.platform as "ios" | "android" | undefined

          switch (action) {
            case "list": {
              if (!platform) {
                const [ios, android] = await Promise.all([Simulator.list("ios"), Simulator.list("android")])
                console.log("iOS Simulators:")
                if (ios.length === 0) console.log("  (none)")
                for (const d of ios) {
                  const icon = d.state === "booted" ? "●" : "○"
                  console.log(`  ${icon} ${d.name} [${d.id}] ${d.runtime ?? ""}  ${d.state}`)
                }
                console.log("")
                console.log("Android Emulators:")
                if (android.length === 0) console.log("  (none)")
                for (const d of android) {
                  const icon = d.state === "booted" ? "●" : "○"
                  console.log(`  ${icon} ${d.name} [${d.id}]  ${d.state}`)
                }
              } else {
                const devices = await Simulator.list(platform)
                const label = platform === "ios" ? "iOS Simulators" : "Android Emulators"
                console.log(`${label}:`)
                if (devices.length === 0) console.log("  (none)")
                for (const d of devices) {
                  const icon = d.state === "booted" ? "●" : "○"
                  console.log(`  ${icon} ${d.name} [${d.id}] ${d.runtime ?? ""}  ${d.state}`)
                }
              }
              break
            }
            case "boot": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform are required")
                process.exit(1)
              }
              console.log(`Booting ${platform} device "${args.device}"...`)
              await Simulator.boot(args.device, platform)
              console.log(`Device "${args.device}" is booting.`)
              break
            }
            case "shutdown": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform are required")
                process.exit(1)
              }
              console.log(`Shutting down ${platform} device "${args.device}"...`)
              await Simulator.shutdown(args.device, platform)
              console.log(`Device "${args.device}" shut down.`)
              break
            }
            case "install": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform are required")
                process.exit(1)
              }
              const target = args.path ?? args.url
              if (!target) {
                console.log("Error: --path or --url is required")
                process.exit(1)
              }
              let artifactPath = args.path
              if (args.url && !args.path) {
                const resp = await fetch(args.url)
                if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)
                const ext = platform === "ios" ? ".ipa" : ".apk"
                artifactPath = `${Bun.env.TMPDIR ?? "/tmp"}/nikcli-install-${Date.now()}${ext}`
                await Bun.write(artifactPath, Buffer.from(await resp.arrayBuffer()))
              }
              console.log(`Installing ${artifactPath} on ${platform} device "${args.device}"...`)
              await Simulator.install(args.device, artifactPath!, platform)
              console.log("App installed successfully.")
              break
            }
            case "screenshot": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform are required")
                process.exit(1)
              }
              const outputPath = args.output ?? `./screenshot-${Date.now()}.png`
              console.log(`Capturing screenshot from ${platform} device "${args.device}"...`)
              await Simulator.screenshot(args.device, outputPath, platform)
              console.log(`Screenshot saved to: ${outputPath}`)
              break
            }
            case "logs": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform are required")
                process.exit(1)
              }
              console.log(`Fetching logs from ${platform} device "${args.device}"...`)
              const logs = await Simulator.logs(args.device, platform, { lines: args.lines, filter: args.filter })
              if (logs.length === 0) {
                console.log("No logs found.")
              } else {
                console.log(logs)
              }
              break
            }
            case "wipe": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform are required")
                process.exit(1)
              }
              console.log(`WARNING: This will erase all data on ${platform} device "${args.device}"`)
              await Simulator.wipe(args.device, platform)
              console.log("Device wiped successfully.")
              break
            }
            case "open": {
              if (!platform) {
                console.log("Error: --platform is required")
                process.exit(1)
              }
              console.log(`Opening ${platform === "ios" ? "iOS Simulator" : "Android Emulator"}...`)
              await Simulator.open(platform)
              break
            }
            case "touch": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform required")
                process.exit(1)
              }
              if (args.x === undefined || args.y === undefined) {
                console.log("Error: --x and --y required")
                process.exit(1)
              }
              const { SimulatorInteract } = await import("@/mobile/simulator-interact")
              await SimulatorInteract.touch(args.device, Number(args.x), Number(args.y))
              console.log(`Touched (${args.x}, ${args.y}).`)
              break
            }
            case "swipe": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform required")
                process.exit(1)
              }
              if ([args.x1, args.y1, args.x2, args.y2].some((v) => v === undefined)) {
                console.log("Error: --x1, --y1, --x2, --y2 required")
                process.exit(1)
              }
              const { SimulatorInteract } = await import("@/mobile/simulator-interact")
              await SimulatorInteract.swipe(
                args.device,
                Number(args.x1),
                Number(args.y1),
                Number(args.x2),
                Number(args.y2),
              )
              console.log(`Swiped (${args.x1},${args.y1}) → (${args.x2},${args.y2}).`)
              break
            }
            case "type": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform required")
                process.exit(1)
              }
              if (!args.text) {
                console.log("Error: --text required")
                process.exit(1)
              }
              const { SimulatorInteract } = await import("@/mobile/simulator-interact")
              await SimulatorInteract.typeText(args.device, args.text)
              console.log(`Typed "${args.text}".`)
              break
            }
            case "launch": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform required")
                process.exit(1)
              }
              if (!args.label) {
                console.log("Error: --label (bundle_id) required")
                process.exit(1)
              }
              const { SimulatorInteract } = await import("@/mobile/simulator-interact")
              const pid = await SimulatorInteract.launchApp(args.device, args.label)
              console.log(`Launched. PID: ${pid}`)
              break
            }
            case "openurl": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform required")
                process.exit(1)
              }
              if (!args.url) {
                console.log("Error: --url required")
                process.exit(1)
              }
              const { SimulatorInteract } = await import("@/mobile/simulator-interact")
              await SimulatorInteract.openURL(args.device, args.url)
              console.log(`Opened ${args.url}.`)
              break
            }
            case "key": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform required")
                process.exit(1)
              }
              if (!args.key) {
                console.log("Error: --key required")
                process.exit(1)
              }
              const { SimulatorInteract } = await import("@/mobile/simulator-interact")
              await SimulatorInteract.sendKey(args.device, args.key)
              console.log(`Sent key ${args.key}.`)
              break
            }
            case "focus": {
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              await SimulatorAutomation.focusSimulator()
              console.log("Simulator focused.")
              break
            }
            case "click_label": {
              if (!args.device) {
                console.log("Error: --device is required")
                process.exit(1)
              }
              if (!args.label) {
                console.log("Error: --label is required")
                process.exit(1)
              }
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              await SimulatorAutomation.focusSimulator()
              await SimulatorAutomation.clickByLabel(args.label)
              console.log(`Clicked "${args.label}".`)
              break
            }
            case "type_text": {
              if (!args.device) {
                console.log("Error: --device is required")
                process.exit(1)
              }
              if (!args.text) {
                console.log("Error: --text is required")
                process.exit(1)
              }
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              await SimulatorAutomation.focusSimulator()
              await SimulatorAutomation.typeViaAppleScript(args.text)
              console.log(`Typed "${args.text}".`)
              break
            }
            case "press_key": {
              if (!args.device) {
                console.log("Error: --device is required")
                process.exit(1)
              }
              if (!args.key) {
                console.log("Error: --key is required")
                process.exit(1)
              }
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              await SimulatorAutomation.focusSimulator()
              if (args.modifiers && (args.modifiers as string[]).length > 0) {
                await SimulatorAutomation.pressKeyCombo(args.key, args.modifiers as string[])
              } else {
                await SimulatorAutomation.pressKey(args.key)
              }
              console.log(`Pressed ${args.key}.`)
              break
            }
            case "command_key": {
              if (!args.device) {
                console.log("Error: --device is required")
                process.exit(1)
              }
              if (!args.key) {
                console.log("Error: --key is required")
                process.exit(1)
              }
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              await SimulatorAutomation.focusSimulator()
              await SimulatorAutomation.commandKey(args.key)
              console.log(`Cmd+${args.key} sent.`)
              break
            }
            case "accessibility_tree": {
              if (!args.device) {
                console.log("Error: --device is required")
                process.exit(1)
              }
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              const tree = await SimulatorAutomation.getAccessibilityTree(args.device)
              console.log(tree.slice(0, 5000))
              break
            }
            case "window_bounds": {
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              const bounds = await SimulatorAutomation.getWindowBounds()
              console.log(`Position: (${bounds.x}, ${bounds.y}) Size: ${bounds.width}x${bounds.height}`)
              break
            }
            case "wait_booted": {
              if (!args.device) {
                console.log("Error: --device is required")
                process.exit(1)
              }
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              console.log(`Waiting for device "${args.device}" to boot...`)
              const ok = await SimulatorAutomation.waitForDevice(args.device, args.timeoutMs ?? 30000)
              console.log(ok ? "Device booted and ready." : "Timeout waiting for boot.")
              break
            }
            case "diagnostics": {
              if (!args.device || !platform) {
                console.log("Error: --device and --platform required")
                process.exit(1)
              }
              console.log(`Running diagnostics on "${args.device}"...`)
              const { SimulatorAutomation } = await import("@/mobile/simulator-automation")
              const [logs, tree] = await Promise.all([
                Simulator.logs(args.device, platform, { lines: 200 }),
                SimulatorAutomation.getAccessibilityTree(args.device).catch(() => "N/A"),
              ])
              const screenshotPath = `/tmp/nikcli-diag-${Date.now()}.png`
              await Simulator.screenshot(args.device, screenshotPath, platform).catch(() => {})
              const errorLines = logs.split("\n").filter((l) => /error|crash|exception|fail|panic/i.test(l))
              console.log(`\n=== DIAGNOSTICS ===`)
              console.log(`Device: ${args.device} (${platform})`)
              console.log(`Logs: ${logs.split("\n").length} lines, ${errorLines.length} errors`)
              if (errorLines.length > 0) {
                console.log(`\n⚠️  ERRORS:`)
                errorLines.slice(0, 20).forEach((l) => console.log(`  ${l}`))
              }
              console.log(`\nScreenshot: ${screenshotPath}`)
              break
            }
          }
        },
      })
      .command({
        command: "rn <action>",
        describe: "React Native CLI tools",
        builder: (yargs) =>
          yargs
            .positional("action", {
              type: "string",
              choices: ["run", "metro", "version"] as const,
              describe: "React Native action to perform",
            })
            .option("platform", {
              type: "string",
              choices: ["ios", "android"] as const,
              describe: "Target platform",
            })
            .option("device", {
              type: "string",
              describe: "Device name or ID to run on",
            })
            .option("configuration", {
              type: "string",
              describe: "Build configuration (Debug, Release)",
            })
            .option("port", {
              type: "number",
              describe: "Metro bundler port",
            }),
        handler: async (args) => {
          const action = args.action as string
          const cwd = process.cwd()

          switch (action) {
            case "run": {
              const platform = args.platform as "ios" | "android" | undefined
              if (!platform) {
                console.log("Error: --platform is required")
                process.exit(1)
              }
              console.log(`Building and running React Native app on ${platform}...`)
              const output = await ReactNative.run({
                platform,
                device: args.device,
                configuration: args.configuration,
                cwd,
              })
              console.log(output)
              break
            }
            case "metro": {
              console.log("Starting Metro bundler...")
              const result = await ReactNative.startMetro({ port: args.port, cwd })
              console.log(`Metro bundler running at ${result.url}`)
              break
            }
            case "version": {
              const version = await ReactNative.version()
              console.log(`React Native CLI: ${version}`)
              break
            }
          }
        },
      })
      .command(MobileTophatCommand)
      .demandCommand(),
  async handler() {},
})
