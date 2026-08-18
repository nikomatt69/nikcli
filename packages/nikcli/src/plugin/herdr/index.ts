/**
 * nikcli Herdr integration — server-side plugin.
 *
 * This file is the entry point the nikcli plugin loader imports to boot the
 * bridge. It does three things:
 *
 *   1. On plugin init, registers a `tool` hook so the agent can call a
 *      `herdr` tool to inspect a running Herdr server (snapshot, list
 *      agents, refresh the workspace view). The tool is always present;
 *      it returns a friendly "not installed" message when herdr is missing
 *      so agents can fall back gracefully.
 *
 *   2. Activates the bridge in `event` mode so every nikcli session
 *      lifecycle event is reported to herdr as a working/idle/blocked
 *      agent — exposing nikcli to herdr's agent sidebar, notifications,
 *      and waits.
 *
 *   3. On `dispose`, tears the bridge down so a hot reload of the plugin
 *      doesn't leave a zombie agent in herdr's sidebar.
 *
 * The companion TUI plugin (`packages/nikcli/src/cli/cmd/tui/feature-plugins/herdr/`)
 * uses the same bridge to surface status in the TUI; the two sides never
 * fight because the bridge is the single source of truth and the TUI only
 * reads + toggles the enabled flag.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import type { Hooks, PluginInput } from "@nikcli-ai/plugin"
import { tool as definePluginTool } from "@nikcli-ai/plugin/tool"
import z from "zod"
import { HerdrBridge } from "@nikcli-ai/util/herdr-bridge"
import * as bridge from "@nikcli-ai/util/herdr-bridge"
import { Global } from "@nikcli-ai/util/global"
import { Log } from "@nikcli-ai/util/log"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "herdr-plugin" })

/**
 * The `herdr` tool — an agent-facing adapter for the bridge. It mirrors
 * everything the bridge can do in a single, well-typed surface, so the
 * agent can drive the integration without needing to know the socket path
 * or the protocol version.
 */
export const HerdrTool = definePluginTool({
  description:
    "Interact with a running Herdr (https://herdr.dev) server. Supports " +
    "checking the bridge status, listing workspaces/tabs/agents, and " +
    "reporting a nikcli session as a herdr agent. Always safe to call: " +
    "returns a `status: not_installed` or `status: no_server` payload when " +
    "herdr is not reachable.",
  args: {
    action: z.enum([
      "status",
      "snapshot",
      "list_agents",
      "list_workspaces",
      "report_session",
      "release_session",
      "refresh",
    ]),
    /** Required for `report_session` / `release_session`. */
    sessionID: z.string().optional(),
    /** Agent label to report to herdr. Defaults to "nikcli". */
    agent: z.string().optional(),
    /** Semantic state for `report_session`. */
    state: z.enum(["idle", "working", "blocked", "done", "unknown"]).optional(),
    /** Optional human-readable message for `report_session`. */
    message: z.string().optional(),
    /** Optional herdr pane id used by `report_session` / `release_session`. */
    paneId: z.string().optional(),
  },
  async execute(params, _ctx) {
    const directory = Instance.directory ?? process.cwd()
    const info = await bridge.detect()
    if (!info.installed) {
      return {
        title: "Herdr not installed",
        metadata: { installed: false },
        output: "Herdr is not installed on PATH. Install it from https://herdr.dev " + "to enable the integration.",
      }
    }
    if (!info.serverRunning) {
      return {
        title: "Herdr server not running",
        metadata: {
          installed: true,
          serverRunning: false,
          socketPath: info.socketPath,
        },
        output: `Herdr binary is at ${info.binPath} but no server is reachable at ${info.socketPath}. Start one with \`herdr\`.`,
      }
    }

    if (params.action === "status") {
      const status = await bridge.status()
      return {
        title: "Herdr status",
        metadata: status as unknown as Record<string, unknown>,
        output: formatStatus(status),
      }
    }

    if (params.action === "snapshot" || params.action === "refresh") {
      const snap = await bridge.refresh(directory)
      return {
        title: "Herdr snapshot",
        metadata: {
          workspaces: snap.workspaces.length,
          tabs: snap.tabs.length,
          panes: snap.panes.length,
          agents: snap.agents.length,
          takenAt: snap.takenAt,
        },
        output: formatSnapshot(snap),
      }
    }

    if (params.action === "list_workspaces") {
      const snap = bridge.snapshot(directory)
      return {
        title: "Herdr workspaces",
        metadata: { count: snap.workspaces.length },
        output: snap.workspaces.length
          ? snap.workspaces.map((w) => formatWorkspace(w)).join("\n")
          : "No workspaces yet. The next line will be populated once you create one with `herdr workspace create`.",
      }
    }

    if (params.action === "list_agents") {
      const snap = bridge.snapshot(directory)
      return {
        title: "Herdr agents",
        metadata: { count: snap.agents.length },
        output: snap.agents.length
          ? snap.agents
              .map(
                (a) =>
                  `• ${a.agent ?? "unknown"} (${a.state ?? "unknown"}) ${a.message ? `— ${a.message}` : ""} [pane ${a.paneId}]`,
              )
              .join("\n")
          : "No agents reported. Herdr only shows agents after a tool runs in a pane or a custom integration reports state.",
      }
    }

    if (params.action === "report_session") {
      if (!params.sessionID) {
        return {
          title: "report_session needs sessionID",
          metadata: {},
          output: "Provide `sessionID` so the bridge knows which pane to report against.",
        }
      }
      const result = await bridge.reportSession({
        directory,
        sessionID: params.sessionID,
        agent: params.agent ?? "nikcli",
        state: params.state ?? "working",
        message: params.message,
        paneId: params.paneId,
      })
      if (!result.ok) {
        return {
          title: "Herdr report failed",
          metadata: { reason: result.reason },
          output: `Could not report agent state to herdr: ${result.reason}.`,
        }
      }
      return {
        title: "Herdr agent reported",
        metadata: {
          agent: params.agent ?? "nikcli",
          state: params.state ?? "working",
        },
        output: `Reported ${params.agent ?? "nikcli"} as ${params.state ?? "working"} to herdr.`,
      }
    }

    if (params.action === "release_session") {
      if (!params.sessionID) {
        return {
          title: "release_session needs sessionID",
          metadata: {},
          output: "Provide `sessionID` so the bridge can release the matching pane.",
        }
      }
      const result = await bridge.releaseSession({
        directory,
        sessionID: params.sessionID,
        agent: params.agent ?? "nikcli",
        paneId: params.paneId,
      })
      if (!result.ok) {
        return {
          title: "Herdr release failed",
          metadata: { reason: result.reason },
          output: `Could not release herdr agent: ${result.reason}.`,
        }
      }
      return {
        title: "Herdr agent released",
        metadata: {},
        output: `Released the nikcli-backed pane in herdr.`,
      }
    }

    // Should never get here — the schema exhausts the action union.
    return {
      title: "Herdr unknown action",
      metadata: {},
      output: `Unknown action: ${String((params as { action: string }).action)}`,
    }
  },
})

function formatStatus(status: {
  installed: boolean
  binPath?: string
  serverRunning: boolean
  socketPath?: string
  enabled: boolean
}): string {
  const lines = [
    `Installed: ${status.installed ? "yes" : "no"}`,
    `Binary: ${status.binPath ?? "(missing)"}`,
    `Server running: ${status.serverRunning ? "yes" : "no"}`,
    `Socket: ${status.socketPath ?? "(none)"}`,
    `Bridge enabled: ${status.enabled ? "yes" : "no"}`,
  ]
  return lines.join("\n")
}

function formatWorkspace(w: {
  id: string
  label?: string
  focused?: boolean
  cwd?: string
  worktree?: { branch: string; path?: string }
}): string {
  const label = w.label ?? w.id
  const focus = w.focused ? " (focused)" : ""
  const branch = w.worktree ? ` [worktree ${w.worktree.branch}]` : ""
  const cwd = w.cwd ? ` — ${w.cwd}` : ""
  return `• ${label}${focus}${branch}${cwd}`
}

function formatSnapshot(snap: {
  takenAt: string
  workspaces: Array<{ id: string; label?: string }>
  tabs: Array<{ id: string; workspaceId: string; label?: string }>
  agents: Array<{ agent?: string; state?: string; message?: string }>
}): string {
  return [
    `Taken at: ${snap.takenAt}`,
    `Workspaces: ${snap.workspaces.length}`,
    `Tabs: ${snap.tabs.length}`,
    `Agents: ${snap.agents.length}`,
    "",
    "Workspaces:",
    ...snap.workspaces.map((w) => `  • ${w.label ?? w.id}`),
    "Tabs:",
    ...snap.tabs.map((t) => `  • ${t.label ?? t.id} in ${t.workspaceId}`),
    "Agents:",
    ...snap.agents.map((a) => `  • ${a.agent ?? "?"} (${a.state ?? "?"})${a.message ? ` — ${a.message}` : ""}`),
  ].join("\n")
}

/**
 * Path of the standalone herdr integration plugin, when the user has one
 * installed. Herdr's installer writes `herdr-agent-state.<ext>` into the
 * agent's own plugin directory (that is how the opencode, kilo, and pi
 * integrations work); nikcli scans both `plugin/` and `plugins/` under
 * its global config dir.
 */
function externalIntegrationPath(): string | undefined {
  for (const dir of ["plugin", "plugins"]) {
    for (const ext of ["js", "ts"]) {
      const candidate = path.join(Global.Path.config, dir, `herdr-agent-state.${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Plugin entry point. Registers the herdr tool and exposes the bridge so
 * the agent can drive it when the user opts in.
 *
 * Auto-attach rule (matches the prime-agent "built-in" pattern): if the
 * process is running inside a Herdr pane (`HERDR_ENV=1` + socket + pane
 * id published by the wrapping server), the bridge enables itself and
 * attaches the global bus listener right away. The user's TUI sees
 * nikcli appear as a Herdr agent without them having to flip a toggle.
 *
 * Outside a Herdr pane the bridge stays dormant: it does not probe the
 * socket, attach any listener, or touch the chat session stream. Users
 * who explicitly want the bridge outside a Herdr pane can enable it
 * through the TUI's `herdr.toggle` command.
 */
export async function HerdrPlugin(_input: PluginInput): Promise<Hooks> {
  if (HerdrBridge.isInHerdrPane()) {
    const external = externalIntegrationPath()
    if (external) {
      // `herdr integration install nikcli` (or a manual copy) dropped the
      // standalone plugin into the user's config dir. It reports under the
      // same `herdr:nikcli` source, so running both would double every
      // report — the installed file wins, we stay dormant.
      log.info("herdr integration file installed; leaving reporting to it", {
        path: external,
      })
    } else {
      log.info("running inside a Herdr pane; auto-enabling bridge")
      HerdrBridge.setEnabled(true)
    }
  } else {
    log.debug("not inside a Herdr pane; bridge stays disabled until manually enabled")
  }

  return {
    async dispose() {
      log.info("disposing herdr plugin")
      // stop() resets runtime.released, so the CLI release has to run after
      // it. Otherwise a late report could reclaim the pane we just handed
      // back. The TUI process also calls releasePaneSync() because Windows
      // never awaits this dispose.
      HerdrBridge.stop()
      HerdrBridge.releasePaneSync()
    },
    async event(input) {
      // Session lifecycle is already covered by the bridge's GlobalBus
      // listener (which also serves the TUI toggle, where no plugin hook
      // runs). Forwarding here too would double every report, so this
      // hook stays a pass-through.
      void input
    },
    // The user just submitted a prompt: mark the pane working before the
    // first `session.status` busy event lands, so herdr's sidebar reacts
    // on the same frame the TUI does.
    "chat.message": async (input) => {
      await HerdrBridge.handleChatMessage(input.sessionID)
    },
    // Tool calls are plugin hooks in nikcli, not bus events, so they need
    // their own wiring to keep a long tool run from looking idle.
    "tool.execute.before": async (input) => {
      await HerdrBridge.handleEvent({
        type: "tool.execute.before",
        properties: { sessionID: input.sessionID },
      })
    },
    "tool.execute.after": async (input) => {
      await HerdrBridge.handleEvent({
        type: "tool.execute.after",
        properties: { sessionID: input.sessionID },
      })
    },
    tool: {
      herdr: HerdrTool,
    },
  }
}

/**
 * Default export — the plugin loader imports this as the module entry.
 * It must be a function: `(input) => Promise<Hooks>`.
 */
export default HerdrPlugin
