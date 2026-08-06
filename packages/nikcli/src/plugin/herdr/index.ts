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
 *      doesn't leave dangling subscriptions or zombie agents.
 *
 * The companion TUI plugin (`packages/nikcli/src/cli/cmd/tui/feature-plugins/herdr/`)
 * uses the same bridge to surface status in the TUI; the two sides never
 * fight because the bridge is the single source of truth and the TUI only
 * reads + toggles the enabled flag.
 */
import type { Hooks, PluginInput } from "@nikcli-ai/plugin";
import { tool as definePluginTool } from "@nikcli-ai/plugin/tool";
import z from "zod";
import { HerdrBridge } from "./bridge";
import * as bridge from "./bridge";
import { Log } from "@/util/log";
import { Instance } from "@/project/instance";

export { HerdrBridge } from "./bridge";

const log = Log.create({ service: "herdr-plugin" });

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
    const directory = Instance.directory ?? process.cwd();
    const info = await bridge.detect();
    if (!info.installed) {
      return {
        title: "Herdr not installed",
        metadata: { installed: false },
        output:
          "Herdr is not installed on PATH. Install it from https://herdr.dev " +
          "to enable the integration.",
      };
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
      };
    }

    if (params.action === "status") {
      const status = await bridge.status();
      return {
        title: "Herdr status",
        metadata: status as unknown as Record<string, unknown>,
        output: formatStatus(status),
      };
    }

    if (params.action === "snapshot" || params.action === "refresh") {
      const snap = await bridge.refresh(directory);
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
      };
    }

    if (params.action === "list_workspaces") {
      const snap = bridge.snapshot(directory);
      return {
        title: "Herdr workspaces",
        metadata: { count: snap.workspaces.length },
        output: snap.workspaces.length
          ? snap.workspaces.map((w) => formatWorkspace(w)).join("\n")
          : "No workspaces yet. The next line will be populated once you create one with `herdr workspace create`.",
      };
    }

    if (params.action === "list_agents") {
      const snap = bridge.snapshot(directory);
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
      };
    }

    if (params.action === "report_session") {
      if (!params.sessionID) {
        return {
          title: "report_session needs sessionID",
          metadata: {},
          output:
            "Provide `sessionID` so the bridge knows which pane to report against.",
        };
      }
      const result = await bridge.reportSession({
        directory,
        sessionID: params.sessionID,
        agent: params.agent ?? "nikcli",
        state: params.state ?? "working",
        message: params.message,
        paneId: params.paneId,
      });
      if (!result.ok) {
        return {
          title: "Herdr report failed",
          metadata: { reason: result.reason },
          output: `Could not report agent state to herdr: ${result.reason}.`,
        };
      }
      return {
        title: "Herdr agent reported",
        metadata: {
          agent: params.agent ?? "nikcli",
          state: params.state ?? "working",
        },
        output: `Reported ${params.agent ?? "nikcli"} as ${params.state ?? "working"} to herdr.`,
      };
    }

    if (params.action === "release_session") {
      if (!params.sessionID) {
        return {
          title: "release_session needs sessionID",
          metadata: {},
          output:
            "Provide `sessionID` so the bridge can release the matching pane.",
        };
      }
      const result = await bridge.releaseSession({
        directory,
        sessionID: params.sessionID,
        agent: params.agent ?? "nikcli",
        paneId: params.paneId,
      });
      if (!result.ok) {
        return {
          title: "Herdr release failed",
          metadata: { reason: result.reason },
          output: `Could not release herdr agent: ${result.reason}.`,
        };
      }
      return {
        title: "Herdr agent released",
        metadata: {},
        output: `Released the nikcli-backed pane in herdr.`,
      };
    }

    // Should never get here — the schema exhausts the action union.
    return {
      title: "Herdr unknown action",
      metadata: {},
      output: `Unknown action: ${String((params as { action: string }).action)}`,
    };
  },
});

function formatStatus(status: {
  installed: boolean;
  binPath?: string;
  serverRunning: boolean;
  socketPath?: string;
  enabled: boolean;
  subscriptions: number;
}): string {
  const lines = [
    `Installed: ${status.installed ? "yes" : "no"}`,
    `Binary: ${status.binPath ?? "(missing)"}`,
    `Server running: ${status.serverRunning ? "yes" : "no"}`,
    `Socket: ${status.socketPath ?? "(none)"}`,
    `Bridge enabled: ${status.enabled ? "yes" : "no"}`,
    `Active subscriptions: ${status.subscriptions}`,
  ];
  return lines.join("\n");
}

function formatWorkspace(w: {
  id: string;
  label?: string;
  focused?: boolean;
  cwd?: string;
  worktree?: { branch: string; path?: string };
}): string {
  const label = w.label ?? w.id;
  const focus = w.focused ? " (focused)" : "";
  const branch = w.worktree ? ` [worktree ${w.worktree.branch}]` : "";
  const cwd = w.cwd ? ` — ${w.cwd}` : "";
  return `• ${label}${focus}${branch}${cwd}`;
}

function formatSnapshot(snap: {
  takenAt: string;
  workspaces: Array<{ id: string; label?: string }>;
  tabs: Array<{ id: string; workspaceId: string; label?: string }>;
  agents: Array<{ agent?: string; state?: string; message?: string }>;
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
    ...snap.agents.map(
      (a) =>
        `  • ${a.agent ?? "?"} (${a.state ?? "?"})${a.message ? ` — ${a.message}` : ""}`,
    ),
  ].join("\n");
}

/**
 * Plugin entry point. Registers the herdr tool and exposes the bridge so
 * the agent can drive it when the user opts in.
 *
 * IMPORTANT: this plugin does NOT auto-attach the bridge to GlobalBus.
 * The bridge is only wired when the user explicitly enables it (via the
 * TUI plugin's `/herdr` command or `setEnabled(true)` from a tool call).
 * Attaching the listener eagerly would intercept every bus event in the
 * process even when the user has no herdr server, which interferes with
 * the chat session stream.
 */
export async function HerdrPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    async dispose() {
      log.info("disposing herdr plugin");
      HerdrBridge.stop();
    },
    async event(input) {
      // The bridge attaches to GlobalBus only when enabled, so a normal
      // event flow (with the plugin registered but not enabled) never
      // touches this code path. We keep the hook for the case where a
      // host wants to inspect every event by passing it through.
      void input;
    },
    tool: {
      herdr: HerdrTool,
    },
  };
}

/**
 * Default export — the plugin loader imports this as the module entry.
 * It must be a function: `(input) => Promise<Hooks>`.
 */
export default HerdrPlugin;
