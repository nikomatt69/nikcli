/**
 * Runtime smoke-test for the Herdr bridge.
 *
 * Connects to the local herdr server (at ~/.config/herdr/herdr.sock) and
 * walks the bridge through a real lifecycle:
 *   1. detect()        — proves the server is reachable
 *   2. reportAgent()   — reports a "working" agent for a test pane
 *   3. snapshot()      — pulls back the live session state
 *   4. refresh()       — refreshes the cached snapshot
 *   5. releasePane()   — releases the pane
 *
 * Run with: `bun run test/plugin/herdr/smoke.ts`
 */
import * as bridge from "@/plugin/herdr/bridge";

async function main() {
  console.log("=== nikcli Herdr bridge smoke-test ===\n");

  const info = await bridge.detect();
  console.log("detect() →");
  console.log("  installed:   ", info.installed);
  console.log("  binPath:     ", info.binPath ?? "(missing)");
  console.log("  serverRun:   ", info.serverRunning);
  console.log("  socketPath:  ", info.socketPath ?? "(none)");

  if (!info.serverRunning) {
    console.log(
      "\nNo herdr server running — skipping live integration checks.",
    );
    return;
  }

  const socketPath = info.socketPath!;
  // Use a real pane from the running server so the server actually accepts
  // the report_agent call. The live list comes from the running snapshot.
  const liveRaw = await bridge.call<unknown>("pane.list", undefined, 3000, {
    socketPath,
  });
  const paneList =
    (liveRaw as { panes?: Array<{ pane_id?: string }> } | undefined)?.panes ??
    [];
  const paneId = paneList[0]?.pane_id ?? "w4:p1";
  const ts = Date.now();
  console.log("Using live pane:", paneId);

  console.log("\nreportAgent(working) →");
  bridge.setEnabled(true);
  const working = await bridge.reportAgent({
    paneId,
    socketPath,
    state: "working",
    message: `smoke test @ ${ts}`,
    agent: "nikcli-smoke",
    source: "herdr:nikcli-smoke",
  });
  console.log(
    "  ok:",
    working.ok,
    "seq:",
    "seq" in working ? working.seq : "-",
    "reason:",
    "reason" in working ? working.reason : "-",
  );

  console.log("\nreportAgent(blocked) →");
  const blocked = await bridge.reportAgent({
    paneId,
    socketPath,
    state: "blocked",
    message: "awaiting permission",
    agent: "nikcli-smoke",
    source: "herdr:nikcli-smoke",
  });
  console.log(
    "  ok:",
    blocked.ok,
    "seq:",
    "seq" in blocked ? blocked.seq : "-",
  );

  console.log("\nreportAgent(idle) →");
  const idle = await bridge.reportAgent({
    paneId,
    socketPath,
    state: "idle",
    agent: "nikcli-smoke",
    source: "herdr:nikcli-smoke",
  });
  console.log("  ok:", idle.ok, "seq:", "seq" in idle ? idle.seq : "-");

  console.log("\nrefresh() →");
  const snap = await bridge.refresh("/tmp");
  console.log("  workspaces:", snap.workspaces.length);
  console.log("  tabs:      ", snap.tabs.length);
  console.log("  panes:     ", snap.panes.length);
  console.log("  agents:    ", snap.agents.length);
  for (const w of snap.workspaces) {
    console.log(
      "  ws",
      w.id,
      "=",
      w.label,
      w.worktree ? `(worktree ${w.worktree.branch})` : "",
    );
  }

  console.log("\nreleasePane() →");
  // Re-enable: releasePane is gated on `runtime.enabled` for the
  // node:net socket path. Different code path from reportAgent (which
  // uses the env-derived path).
  const released = await bridge.releasePane({ paneId, socketPath });
  console.log(
    "  ok:",
    released.ok,
    "reason:",
    "reason" in released ? released.reason : "-",
  );

  console.log("\nstatus() →");
  const s = await bridge.status();
  console.log("  enabled:    ", s.enabled);
  console.log("  serverRun:  ", s.serverRunning);
  console.log("  inHerdrPane:", s.inHerdrPane);
  console.log("  subs:       ", s.subscriptions);

  console.log("\n=== done ===");
}

await main();
