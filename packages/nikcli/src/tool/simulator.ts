import z from "zod"
import { Tool } from "./tool"
import { Simulator } from "@/mobile/simulator"
import { SimulatorInteract } from "@/mobile/simulator-interact"
import { SimulatorAutomation } from "@/mobile/simulator-automation"
import path from "path"
import DESCRIPTION from "./simulator.txt"

export const SimulatorTool = Tool.define("simulator", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum([
        "list", "boot", "shutdown", "install", "screenshot", "logs", "wipe", "open",
        "touch", "swipe", "type", "launch", "openurl", "key",
        "focus", "click_label", "type_text", "press_key", "command_key",
        "accessibility_tree", "window_bounds", "wait_booted",
        "diagnostics",

        "press_key",
        "command_key",
        "accessibility_tree",
        "window_bounds",
        "wait_booted",
      ])
      .describe("Action to perform"),
    device_id: z.string().optional().describe("Device ID from simulator_list"),
    platform: z.enum(["ios", "android"]).optional().describe("Target platform"),
    path: z.string().optional().describe("Local file path to .ipa/.apk"),
    url: z.string().optional().describe("URL for download or openurl action"),
    output: z.string().optional().describe("Output file path for screenshot"),
    filter: z.string().optional().describe("Filter pattern for logs"),
    lines: z.number().optional().describe("Number of log lines (default: 100)"),
    bundle_id: z.string().optional().describe("App bundle ID for launch action"),
    x: z.number().optional().describe("X coordinate for touch"),
    y: z.number().optional().describe("Y coordinate for touch"),
    x1: z.number().optional().describe("Start X for swipe"),
    y1: z.number().optional().describe("Start Y for swipe"),
    x2: z.number().optional().describe("End X for swipe"),
    y2: z.number().optional().describe("End Y for swipe"),
    text: z.string().optional().describe("Text to type"),
    key: z.string().optional().describe("Key name (home, return, escape, arrow keys, a-z, 0-9)"),
    modifiers: z.array(z.string()).optional().describe("Key modifiers (command, shift, option, control)"),
    label: z.string().optional().describe("Accessibility label to click"),
    long_press: z.boolean().optional().describe("Long press instead of tap"),
    duration_ms: z.number().optional().describe("Long press duration in ms"),
    args: z.array(z.string()).optional().describe("Args for launch action"),
    timeout_ms: z.number().optional().describe("Timeout for wait_booted (default: 30000)"),
  }),
  async execute(p, ctx) {
    const { action, device_id, platform } = p

    // Actions that don't need device_id
    if (action === "open") {
      const pl = platform ?? "ios"
      await Simulator.open(pl)
      return {
        title: `Opened ${pl} simulator`,
        metadata: { platform: pl } as Record<string, unknown>,
        output: `Simulator app opened.`,
      }
    }

    if (action === "focus") {
      await SimulatorAutomation.focusSimulator()
      return { title: "Simulator focused", metadata: {}, output: "Simulator app brought to front." }
    }

    if (action === "list") {
      if (!platform) throw new Error("--platform required")
      const devs = await Simulator.list(platform)
      const lbl = platform === "ios" ? "iOS Simulator" : "Android Emulator"
      if (!devs.length)
        return {
          title: `No ${lbl}s found`,
          metadata: { platform, count: 0 } as Record<string, unknown>,
          output: `No ${lbl}s found.`,
        }
      const lines = devs.map(
        (d) =>
          `  ${d.state === "booted" ? "●" : "○"} ${d.name} [${d.id}]${d.runtime ? ` (${d.runtime})` : ""}  ${d.state}`,
      )
      return {
        title: `${devs.length} ${lbl}(s)`,
        metadata: { platform, count: devs.length } as Record<string, unknown>,
        output: `${lbl}s:\n${lines.join("\n")}`,
      }
    }

    // All other actions need device_id
    if (!device_id) throw new Error(`--device_id required for '${action}'`)

    switch (action) {
      case "boot": {
        await ctx.ask({
          permission: "simulator",
          patterns: [`boot ${device_id}`],
          always: [`xcrun simctl boot ${device_id}`],
          metadata: { device_id, platform },
        })
        await Simulator.boot(device_id, platform ?? "ios")
        return { title: `Booted ${device_id}`, metadata: { device_id }, output: `Device booting.` }
      }
      case "shutdown": {
        await ctx.ask({
          permission: "simulator",
          patterns: [`shutdown ${device_id}`],
          always: [`xcrun simctl shutdown ${device_id}`],
          metadata: { device_id },
        })
        await Simulator.shutdown(device_id, platform ?? "ios")
        return { title: `Shut down`, metadata: { device_id }, output: `Device shut down.` }
      }
      case "install": {
        if (!p.path && !p.url) throw new Error("--path or --url required")
        let ap = p.path
        if (p.url && !p.path) {
          const r = await fetch(p.url)
          if (!r.ok) throw new Error(`Download failed: ${r.status}`)
          const ext = platform === "ios" ? ".ipa" : ".apk"
          ap = `/tmp/nikcli-${Date.now()}${ext}`
          await Bun.write(ap, Buffer.from(await r.arrayBuffer()))
        }
        await ctx.ask({
          permission: "simulator",
          patterns: [ap ?? ""],
          always: [`xcrun simctl install ${device_id} ${ap}`],
          metadata: { device_id },
        })
        await Simulator.install(device_id, ap!, platform ?? "ios")
        return { title: "App installed", metadata: { device_id }, output: `Installed on device.` }
      }
      case "screenshot": {
        const out = p.output ?? path.join(process.cwd(), `screenshot-${Date.now()}.png`)
        await Simulator.screenshot(device_id, out, platform ?? "ios")
        return { title: "Screenshot captured", metadata: { device_id, output: out }, output: `Saved to: ${out}` }
      }
      case "logs": {
        const logs = await Simulator.logs(device_id, platform ?? "ios", { lines: p.lines, filter: p.filter })
        const total = logs.split("\n").length
        return {
          title: "Device logs",
          metadata: { device_id, totalLines: total },
          output:
            total > 0
              ? `Logs (${total}):\n${logs.split("\n").slice(0, 50).join("\n")}${total > 50 ? `\n... (${total - 50} more)` : ""}`
              : "No logs found.",
        }
      }
      case "wipe": {
        await ctx.ask({
          permission: "simulator",
          patterns: [`wipe ${device_id}`],
          always: [`xcrun simctl erase ${device_id}`],
          metadata: { device_id },
        })
        await Simulator.wipe(device_id, platform ?? "ios")
        return { title: "Device wiped", metadata: { device_id }, output: `Reset to factory state.` }
      }
      case "touch": {
        if (p.x === undefined || p.y === undefined) throw new Error("--x and --y required")
        await ctx.ask({
          permission: "simulator",
          patterns: ["touch"],
          always: [`xcrun simctl io ${device_id} touch ${p.x} ${p.y}`],
          metadata: { device_id },
        })
        if (p.long_press) {
          await SimulatorInteract.longPress(device_id, p.x, p.y, p.duration_ms ?? 500)
        } else {
          await SimulatorInteract.touch(device_id, p.x, p.y)
        }
        return {
          title: `${p.long_press ? "Long pressed" : "Tapped"} (${p.x}, ${p.y})`,
          metadata: { device_id, x: p.x, y: p.y },
          output: `Touched at (${p.x}, ${p.y}).`,
        }
      }
      case "swipe": {
        if ([p.x1, p.y1, p.x2, p.y2].some((v) => v === undefined)) throw new Error("--x1, --y1, --x2, --y2 required")
        await ctx.ask({
          permission: "simulator",
          patterns: ["swipe"],
          always: [`xcrun simctl io ${device_id} swipe ${p.x1} ${p.y1} ${p.x2} ${p.y2}`],
          metadata: { device_id },
        })
        await SimulatorInteract.swipe(device_id, p.x1!, p.y1!, p.x2!, p.y2!)
        return { title: `Swiped`, metadata: { device_id }, output: `Swiped (${p.x1},${p.y1}) → (${p.x2},${p.y2}).` }
      }
      case "type": {
        if (!p.text) throw new Error("--text required")
        await ctx.ask({
          permission: "simulator",
          patterns: ["type"],
          always: [`keyboard input "${p.text}"`],
          metadata: { device_id },
        })
        await SimulatorInteract.typeText(device_id, p.text)
        return { title: `Typed "${p.text}"`, metadata: { device_id }, output: `Typed on device.` }
      }
      case "launch": {
        if (!p.bundle_id) throw new Error("--bundle_id required")
        await ctx.ask({
          permission: "simulator",
          patterns: [`launch ${p.bundle_id}`],
          always: [`xcrun simctl launch ${device_id} ${p.bundle_id}`],
          metadata: { device_id },
        })
        const pid = await SimulatorInteract.launchApp(device_id, p.bundle_id, { args: p.args })
        return { title: `Launched ${p.bundle_id}`, metadata: { device_id, pid }, output: `App launched.` }
      }
      case "openurl": {
        if (!p.url) throw new Error("--url required")
        await ctx.ask({
          permission: "simulator",
          patterns: ["openurl"],
          always: [`xcrun simctl openurl ${device_id} "${p.url}"`],
          metadata: { device_id },
        })
        await SimulatorInteract.openURL(device_id, p.url)
        return { title: `Opened ${p.url}`, metadata: { device_id }, output: `URL opened.` }
      }
      case "key": {
        if (!p.key) throw new Error("--key required")
        await ctx.ask({
          permission: "simulator",
          patterns: [`key ${p.key}`],
          always: [`xcrun simctl io ${device_id} press ${p.key}`],
          metadata: { device_id },
        })
        await SimulatorInteract.sendKey(device_id, p.key)
        return { title: `Pressed ${p.key}`, metadata: { device_id }, output: `Key event sent.` }
      }

      // === AppleScript automation actions ===
      case "click_label": {
        if (!p.label) throw new Error("--label required")
        await ctx.ask({
          permission: "simulator",
          patterns: [`click ${p.label}`],
          always: [`click button "${p.label}"`],
          metadata: { device_id },
        })
        await SimulatorAutomation.focusSimulator()
        await SimulatorAutomation.clickByLabel(p.label)
        return {
          title: `Clicked "${p.label}"`,
          metadata: { device_id, label: p.label },
          output: `Clicked element with label "${p.label}".`,
        }
      }
      case "type_text": {
        if (!p.text) throw new Error("--text required")
        await ctx.ask({
          permission: "simulator",
          patterns: ["type"],
          always: [`keystroke "${p.text}"`],
          metadata: { device_id },
        })
        await SimulatorAutomation.focusSimulator()
        await SimulatorAutomation.typeViaAppleScript(p.text)
        return { title: `Typed "${p.text}"`, metadata: { device_id }, output: `Typed via AppleScript.` }
      }
      case "press_key": {
        if (!p.key) throw new Error("--key required")
        await ctx.ask({
          permission: "simulator",
          patterns: [`press ${p.key}`],
          always: [`key code ${p.key}`],
          metadata: { device_id },
        })
        await SimulatorAutomation.focusSimulator()
        if (p.modifiers && p.modifiers.length > 0) {
          await SimulatorAutomation.pressKeyCombo(p.key, p.modifiers)
        } else {
          await SimulatorAutomation.pressKey(p.key)
        }
        return {
          title: `Pressed ${p.modifiers?.length ? p.modifiers.join("+") + "+" : ""}${p.key}`,
          metadata: { device_id },
          output: `Key pressed.`,
        }
      }
      case "command_key": {
        if (!p.key) throw new Error("--key required for command_key")
        await ctx.ask({
          permission: "simulator",
          patterns: [`cmd+${p.key}`],
          always: [`command+${p.key}`],
          metadata: { device_id },
        })
        await SimulatorAutomation.focusSimulator()
        await SimulatorAutomation.commandKey(p.key)
        return { title: `Cmd+${p.key}`, metadata: { device_id }, output: `Command key combo sent.` }
      }
      case "accessibility_tree": {
        const tree = await SimulatorAutomation.getAccessibilityTree(device_id)
        return {
          title: "Accessibility tree",
          metadata: { device_id, length: tree.length },
          output: tree.slice(0, 3000) + (tree.length > 3000 ? "\n... (truncated)" : ""),
        }
      }
      case "window_bounds": {
        const bounds = await SimulatorAutomation.getWindowBounds()
        return {
          title: "Window bounds",
          metadata: { device_id, ...bounds } as Record<string, unknown>,
          output: `Position: (${bounds.x}, ${bounds.y}) Size: ${bounds.width}x${bounds.height}`,
        }
      }
      case "wait_booted": {
        const ok = await SimulatorAutomation.waitForDevice(device_id, p.timeout_ms ?? 30000)
        return {
          title: ok ? "Device booted" : "Timeout waiting",
          metadata: { device_id, booted: ok },
          output: ok ? `Device "${device_id}" is booted and ready.` : `Timeout waiting for "${device_id}" to boot.`,
        }
      }
      case "diagnostics": {
        const pl = platform ?? "ios"
        const outPath = `/tmp/nikcli-diag-${Date.now()}.png`
        const [logsResult, treeResult] = await Promise.allSettled([
          Simulator.logs(device_id, pl, { lines: p.lines ?? 200 }),
          SimulatorAutomation.getAccessibilityTree(device_id),
        ])
        const logs = logsResult.status === "fulfilled" ? logsResult.value : "Failed to get logs"
        const tree = treeResult.status === "fulfilled" ? treeResult.value : "Failed to get accessibility tree"
        try { await Simulator.screenshot(device_id, outPath, pl) } catch { }
        const totalLines = logs.split("\n").length
        const errorLines = logs.split("\n").filter((l) => /error|crash|exception|fail|panic|assert/i.test(l))
        const output = [
          `=== DIAGNOSTICS for ${device_id} ===`,
          `Platform: ${pl}`,
          `Logs: ${totalLines} lines (${errorLines.length} errors/warnings)`,
          errorLines.length > 0 ? `\n⚠️  ERRORS FOUND:\n${errorLines.slice(0, 20).join("\n")}` : "\n✅ No errors in logs",
          `\n=== LOGS (last 100 lines) ===`,
          logs.split("\n").slice(-100).join("\n"),
          `\n=== ACCESSIBILITY TREE ===`,
          tree.slice(0, 2000),
          `\n=== SCREENSHOT ===`,
          `Saved to: ${outPath}`,
        ].join("\n")
        return {
          title: `${errorLines.length > 0 ? `⚠️ ${errorLines.length} errors found` : "✅ No errors"}`,
          metadata: { device_id, totalLines, errorCount: errorLines.length, screenshot: outPath } as Record<string, unknown>,
          output,
        }
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  },
})
