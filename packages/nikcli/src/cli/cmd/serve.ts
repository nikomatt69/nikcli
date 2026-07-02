import { Server } from "../../server/server";
import { cmd } from "./cmd";
import { withNetworkOptions, resolveNetworkOptions } from "../network";
import { Flag } from "../../flag/flag";
import { Workspace } from "../../workspace";
import { Project } from "../../project/project";
import { Installation } from "../../installation";
import { Effect } from "effect";
import { runPromiseWithLayer } from "@/effect";
import { RemoteSync } from "@/sync/remote-sync";
import { Log } from "@/util/log";

const log = Log.create({ service: "cli.serve" });

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect);
}

async function maybeStartRemoteSync(): Promise<
  { stop(): Promise<void> } | undefined
> {
  const url = process.env.NIKCLI_REMOTE_URL?.replace(/\/$/, "");
  const token = process.env.NIKCLI_REMOTE_TOKEN;
  if (!url || !token) return undefined;
  // Lazy import to avoid pulling the remote client into the local-only path
  const { Project: ProjectSvc } = await import("../../project/project");
  const projects = await runProject(
    Effect.gen(function* () {
      const project = yield* ProjectSvc.Service;
      return yield* project.list();
    }),
  );
  const handles = await Promise.all(
    projects.map((project) =>
      RemoteSync.start({ url, token, projectID: project.id }).catch((error) => {
        log.warn("remote sync start failed", { projectID: project.id, error });
        return undefined;
      }),
    ),
  );
  const valid = handles.filter(
    (h): h is Awaited<ReturnType<typeof RemoteSync.start>> => Boolean(h),
  );
  log.info("remote sync wired", { url, projects: valid.length });
  return {
    async stop() {
      await Promise.all(valid.map((h) => h.stop()));
    },
  };
}

export const ServeCommand = cmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless nikcli server",
  handler: async (args) => {
    const opts = await resolveNetworkOptions(
      args as Parameters<typeof resolveNetworkOptions>[0],
    );

    const loopback =
      opts.hostname === "127.0.0.1" ||
      opts.hostname === "::1" ||
      opts.hostname === "localhost";
    const tailscaleAuthActive = Flag.NIKCLI_SERVER_TAILSCALE_AUTH && loopback;

    if (Flag.NIKCLI_SERVER_TAILSCALE_AUTH && !loopback) {
      console.log(
        "Warning: NIKCLI_SERVER_TAILSCALE_AUTH is set but hostname is not loopback; Tailscale identity headers will not be trusted.",
      );
    }

    if (!Flag.NIKCLI_SERVER_PASSWORD && !tailscaleAuthActive) {
      console.log(
        "Warning: NIKCLI_SERVER_PASSWORD is not set; server is unsecured.",
      );
    }

    const server = Server.listen(opts);
    console.log(
      `nikcli server listening on http://${server.hostname}:${server.port}`,
    );

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
    // NIKCLI_REMOTE_TOKEN. Zero impact when env is not set.
    const remoteSync = await maybeStartRemoteSync();

    await new Promise(() => {});

    await server.stop();
    if (remoteSync) await remoteSync.stop();
    await Promise.all(workspaceSync.map((item) => item.stop()));
  },
});
