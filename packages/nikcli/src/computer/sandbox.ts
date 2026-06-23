import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { Instance } from "@/project/instance";
import { Log } from "@/util/log";
import { SandboxImage } from "./sandbox-image";

/**
 * Background "computer use" desktop. One isolated Linux desktop container per
 * nikcli conversation, driven headlessly via `docker exec` and never touching
 * the host screen. A noVNC web endpoint is exposed for an optional live
 * preview, mirroring how the `browser` tool surfaces a `liveUrl`.
 *
 * The container runtime is Docker — on macOS this is provided by colima/lima
 * (a lightweight Linux VM), so the desktop runs inside that VM, fully isolated
 * from the Mac's own display.
 */
export namespace Sandbox {
  const log = Log.create({ service: "computer-sandbox" });

  export type Desktop = {
    nikcliSessionID: string;
    containerID: string;
    name: string;
    port: number;
    liveUrl: string;
    width: number;
    height: number;
  };

  export type Exec = {
    code: number;
    stdout: Buffer;
    stderr: string;
  };

  type State = {
    desktops: Map<string, Desktop>;
    imageReady?: boolean;
  };

  const state = Instance.state<State>(
    () => ({ desktops: new Map() }),
    async (current) => {
      const all = [...current.desktops.values()];
      current.desktops.clear();
      await Promise.allSettled(all.map((d) => removeContainer(d.containerID)));
    },
  );

  /** The container runtime binary. Docker, backed by colima on macOS. */
  const RUNTIME = process.env.NIKCLI_COMPUTER_RUNTIME?.trim() || "docker";

  async function spawn(
    args: string[],
    options?: { input?: string; binary?: boolean },
  ): Promise<Exec> {
    const proc = Bun.spawn([RUNTIME, ...args], {
      stdin: options?.input ? new TextEncoder().encode(options.input) : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdoutBuf, stderr, code] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout: Buffer.from(stdoutBuf), stderr };
  }

  /** Whether a usable container runtime/daemon is reachable. */
  export async function available(): Promise<boolean> {
    try {
      const { code } = await spawn(["info", "--format", "{{.ServerVersion}}"]);
      return code === 0;
    } catch {
      return false;
    }
  }

  function notReadyError(): Error {
    return new Error(
      `The background computer sandbox needs a container runtime. \`${RUNTIME}\` is not reachable.\n` +
        "On macOS start it with colima (already a lightweight Linux VM):\n" +
        "  colima start --cpu 4 --memory 6 --disk 30\n" +
        "Then retry. Set NIKCLI_COMPUTER_RUNTIME to override the runtime binary.",
    );
  }

  async function imageExists(): Promise<boolean> {
    const { code } = await spawn(["image", "inspect", SandboxImage.TAG]);
    return code === 0;
  }

  /** Build the desktop image if the content-addressed tag is not present. */
  export async function ensureImage(
    onProgress?: (line: string) => void,
  ): Promise<void> {
    const current = state();
    if (current.imageReady) return;
    if (!(await available())) throw notReadyError();
    if (await imageExists()) {
      current.imageReady = true;
      return;
    }

    onProgress?.(`Building computer sandbox image ${SandboxImage.TAG} …`);
    log.info("building sandbox image", { tag: SandboxImage.TAG });
    const dir = await mkdtemp(path.join(os.tmpdir(), "nikcli-sandbox-"));
    try {
      await writeFile(path.join(dir, "Dockerfile"), SandboxImage.DOCKERFILE);
      await writeFile(path.join(dir, "entrypoint.sh"), SandboxImage.ENTRYPOINT);
      const proc = Bun.spawn(
        [RUNTIME, "build", "-t", SandboxImage.TAG, dir],
        { stdout: "pipe", stderr: "pipe" },
      );
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      if (code !== 0) {
        throw new Error(`Failed to build computer sandbox image:\n${stderr}`);
      }
      current.imageReady = true;
      onProgress?.("Computer sandbox image ready.");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function removeContainer(idOrName: string): Promise<void> {
    await spawn(["rm", "-f", idOrName]).catch(() => {});
  }

  function shortId(nikcliSessionID: string): string {
    return nikcliSessionID.replace(/[^a-zA-Z0-9_.-]/g, "").slice(-24) || "default";
  }

  async function isRunning(containerID: string): Promise<boolean> {
    const { code, stdout } = await spawn([
      "inspect",
      "-f",
      "{{.State.Running}}",
      containerID,
    ]);
    return code === 0 && stdout.toString().trim() === "true";
  }

  async function publishedPort(containerID: string): Promise<number | undefined> {
    const { code, stdout } = await spawn([
      "port",
      containerID,
      `${SandboxImage.VNC_PORT}/tcp`,
    ]);
    if (code !== 0) return undefined;
    // e.g. "127.0.0.1:54321" possibly multiple lines.
    const match = stdout.toString().match(/:(\d+)\s*$/m);
    return match ? Number(match[1]) : undefined;
  }

  function liveUrlFor(port: number): string {
    return `http://127.0.0.1:${port}/vnc.html?autoconnect=true&resize=remote&path=websockify`;
  }

  async function waitForDisplay(containerID: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { code } = await spawn([
        "exec",
        "-e",
        "DISPLAY=:99",
        containerID,
        "xdpyinfo",
      ]);
      if (code === 0) return;
      await Bun.sleep(150);
    }
    throw new Error("Sandbox desktop did not become ready in time.");
  }

  export function local(nikcliSessionID: string): Desktop | undefined {
    return state().desktops.get(nikcliSessionID);
  }

  async function create(
    nikcliSessionID: string,
    opts: { width?: number; height?: number } = {},
  ): Promise<Desktop> {
    await ensureImage();
    const width = opts.width ?? SandboxImage.DEFAULT_WIDTH;
    const height = opts.height ?? SandboxImage.DEFAULT_HEIGHT;
    const name = `nikcli-computer-${shortId(nikcliSessionID)}`;
    await removeContainer(name);

    const { code, stdout, stderr } = await spawn([
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--shm-size=512m",
      "-p",
      `127.0.0.1::${SandboxImage.VNC_PORT}`,
      "-e",
      `SCREEN_W=${width}`,
      "-e",
      `SCREEN_H=${height}`,
      SandboxImage.TAG,
    ]);
    if (code !== 0) {
      throw new Error(`Failed to start computer sandbox:\n${stderr}`);
    }
    const containerID = stdout.toString().trim();
    const port = await publishedPort(containerID);
    if (!port) {
      await removeContainer(containerID);
      throw new Error("Could not determine the sandbox preview port.");
    }
    await waitForDisplay(containerID);

    const desktop: Desktop = {
      nikcliSessionID,
      containerID,
      name,
      port,
      liveUrl: liveUrlFor(port),
      width,
      height,
    };
    state().desktops.set(nikcliSessionID, desktop);
    log.info("sandbox desktop ready", { name, port });
    return desktop;
  }

  /** Get the desktop for this conversation, creating/recreating as needed. */
  export async function ensure(
    nikcliSessionID: string,
    opts: { width?: number; height?: number } = {},
  ): Promise<Desktop> {
    const existing = local(nikcliSessionID);
    if (existing && (await isRunning(existing.containerID))) return existing;
    if (existing) state().desktops.delete(nikcliSessionID);
    return create(nikcliSessionID, opts);
  }

  /** Run a command inside the desktop with DISPLAY set. */
  export async function exec(
    nikcliSessionID: string,
    command: string[],
    options?: { binary?: boolean },
  ): Promise<Exec> {
    const desktop = await ensure(nikcliSessionID);
    return spawn(["exec", "-e", "DISPLAY=:99", desktop.containerID, ...command], options);
  }

  export async function status(
    nikcliSessionID: string,
  ): Promise<{ running: boolean; desktop?: Desktop }> {
    const desktop = local(nikcliSessionID);
    if (!desktop) return { running: false };
    return { running: await isRunning(desktop.containerID), desktop };
  }

  export async function close(nikcliSessionID: string): Promise<boolean> {
    const current = state();
    const desktop = current.desktops.get(nikcliSessionID);
    if (!desktop) return false;
    current.desktops.delete(nikcliSessionID);
    await removeContainer(desktop.containerID);
    return true;
  }
}
