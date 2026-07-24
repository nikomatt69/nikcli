import { Server } from "../../server/server";
import { cmd } from "./cmd";
import { withNetworkOptions, resolveNetworkOptions } from "../network";
import { Flag } from "../../flag/flag";
import { Workspace } from "../../workspace";
import { Project } from "../../project/project";
import { Installation } from "../../installation";
import { Log } from "@/util/log";
import { Effect } from "effect";
import { runPromiseWithLayer } from "@/effect";

const log = Log.create({ service: "serve" });

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect);
}

async function maybeStartRemoteSync(): Promise<
  { stop(): Promise<void> } | undefined
> {
  const { SyncConfig } = await import("@/sync/sync-config");
  const resolved = await SyncConfig.resolve();
  if (!resolved.url || !resolved.token) return undefined;
  // Lazy import to avoid pulling the remote client into the local-only path
  const { SyncCliInit } = await import("@/sync/cli-init");
  return SyncCliInit.startForAllProjects({
    url: resolved.url,
    token: resolved.token,
  });
}

/**
 * Probe the public health endpoint until the full route stack (middleware
 * chain included) answers, so `serve` only reports readiness once the server
 * actually responds — not merely once the socket is bound. `/global/health`
 * is a public path (httpapi/auth.ts), so the probe works regardless of
 * NIKCLI_SERVER_PASSWORD.
 */
async function waitForHealthy(url: URL, timeoutMs = 10_000): Promise<void> {
  const health = new URL("/global/health", url);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(health, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`health check returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(50);
  }
  throw new Error(
    `server did not become healthy within ${timeoutMs}ms: ${lastError}`,
  );
}

/**
 * Resolves on the first SIGINT/SIGTERM so graceful cleanup runs. A second
 * signal force-exits immediately in case cleanup wedges.
 */
function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    let intercepted = false;
    const handler = () => {
      if (intercepted) process.exit(1);
      intercepted = true;
      resolve();
    };
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  });
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("stdio", {
      type: "boolean",
      describe:
        "print the readiness handshake as a single JSON line on stdout (for parent processes)",
      default: false,
    }),
  describe: "starts a headless nikcli server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(
      args as Parameters<typeof resolveNetworkOptions>[0],
    );
    // In --stdio mode stdout carries only the machine-readable handshake;
    // all diagnostics go to stderr.
    const warn = args.stdio ? console.error : console.log;

    const loopback =
      opts.hostname === "127.0.0.1" ||
      opts.hostname === "::1" ||
      opts.hostname === "localhost";
    const tailscaleAuthActive = Flag.NIKCLI_SERVER_TAILSCALE_AUTH && loopback;

    if (Flag.NIKCLI_SERVER_TAILSCALE_AUTH && !loopback) {
      warn(
        "Warning: NIKCLI_SERVER_TAILSCALE_AUTH is set but hostname is not loopback; Tailscale identity headers will not be trusted.",
      );
    }

    if (!Flag.NIKCLI_SERVER_PASSWORD && !tailscaleAuthActive) {
      warn("Warning: NIKCLI_SERVER_PASSWORD is not set; server is unsecured.");
    }

    const server = Server.listen(opts);
    // Announce the address only once the server has answered a real request, so
    // a broken route table surfaces here instead of on the client's first call.
    // If readiness probing fails, stop the server before propagating the error
    // so we don't leak a bound-but-unhealthy listener.
    try {
      await waitForHealthy(server.url);
    } catch (error) {
      await server.stop(true).catch(() => undefined);
      throw error;
    }
    if (args.stdio) {
      console.log(JSON.stringify({ url: server.url.origin }));
    } else {
      console.log(
        `nikcli server listening on http://${server.hostname}:${server.port}`,
      );
    }

    let workspaceSync: Array<ReturnType<typeof Workspace.startSyncing>> = [];
    if (Installation.isLocal()) {
      const projects = await runProject(
        Effect.gen(function* () {
          const project = yield* Project.Service;
          return yield* project.list();
        }),
      );
      workspaceSync = projects.map((project) =>
        Workspace.startSyncing(project),
      );
    }

    // Phase 2: optional bidirectional sync to a remote hub
    // (e.g. https://s.nikcli.store). Activated by NIKCLI_REMOTE_URL +
    // NIKCLI_REMOTE_TOKEN or the config file's `sync` block. Zero impact
    // when neither is set.
    const remoteSync = await maybeStartRemoteSync();

    await waitForShutdownSignal();

    // Graceful shutdown: close keep-alive connections (SSE streams hold
    // sockets open and would otherwise hang the exit), then stop sync
    // services. Force-exit if any of this hangs for more than 5s.
    log.info("shutting down");
    warn("shutting down...");
    const force = setTimeout(() => {
      console.error("graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 5_000);
    try {
      await server.stop(true);
      if (remoteSync) await remoteSync.stop();
      await Promise.all(workspaceSync.map((item) => item.stop()));
    } finally {
      clearTimeout(force);
    }
    process.exit(0);
  },
});
