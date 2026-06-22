import fs from "fs/promises";
import path from "path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { Global } from "@/global";
import type { Config } from "../config";
import type { Adaptor, Target } from "./types";
import { WorktreeAdaptor } from "./worktree";

type ContainerConfig = Extract<Config, { type: "container" }>;

const CONFIGURED_CONTAINER_IMAGE =
  process.env.NIKCLI_MOBILE_CONTAINER_IMAGE?.trim();
const LOCAL_CONTAINER_IMAGE = "nikcli-mobile-workspace:local";
const LOCAL_CONTAINER_DOCKERFILE = fileURLToPath(
  new URL("../../../../../Dockerfile.serve", import.meta.url),
);
const LOCAL_CONTAINER_CONTEXT = path.dirname(LOCAL_CONTAINER_DOCKERFILE);

type ContainerImageSource =
  | {
      image: string;
      source: "configured";
    }
  | {
      image: string;
      source: "local-build";
      dockerfile: string;
      context: string;
    };

type ContainerRuntimeInfo = {
  available: boolean;
  runtime?: ContainerConfig["runtime"];
  image: string;
};

async function hasLocalContainerBuildContext() {
  return fs
    .stat(LOCAL_CONTAINER_DOCKERFILE)
    .then((entry) => entry.isFile())
    .catch(() => false);
}

async function resolveContainerImageSource(): Promise<
  ContainerImageSource | undefined
> {
  if (CONFIGURED_CONTAINER_IMAGE) {
    return {
      image: CONFIGURED_CONTAINER_IMAGE,
      source: "configured",
    };
  }

  if (await hasLocalContainerBuildContext()) {
    return {
      image: LOCAL_CONTAINER_IMAGE,
      source: "local-build",
      dockerfile: LOCAL_CONTAINER_DOCKERFILE,
      context: LOCAL_CONTAINER_CONTEXT,
    };
  }

  return undefined;
}

function containerRuntime(): ContainerConfig["runtime"] | undefined {
  if (Bun.which("docker")) return "docker";
  if (Bun.which("podman")) return "podman";
  return undefined;
}

async function isRuntimeHealthy(runtime: ContainerConfig["runtime"]) {
  const result = await runContainerCommand(runtime, ["info"], true);
  return result.exitCode === 0;
}

async function ensureContainerImage(
  runtime: ContainerConfig["runtime"],
  source: ContainerImageSource,
) {
  if (source.source === "configured") return source.image;

  const inspect = await runContainerCommand(
    runtime,
    ["image", "inspect", source.image],
    true,
  );
  if (inspect.exitCode === 0) return source.image;

  await runContainerCommand(runtime, [
    "build",
    "-f",
    source.dockerfile,
    "-t",
    source.image,
    source.context,
  ]);
  return source.image;
}

export async function getContainerRuntimeInfo(): Promise<ContainerRuntimeInfo> {
  const runtime = containerRuntime();
  const imageSource = await resolveContainerImageSource();

  if (!runtime) {
    return {
      available: false,
      runtime: undefined,
      image: imageSource?.image ?? LOCAL_CONTAINER_IMAGE,
    };
  }

  const healthy = await isRuntimeHealthy(runtime);

  return {
    available: healthy && Boolean(imageSource),
    runtime,
    image: imageSource?.image ?? LOCAL_CONTAINER_IMAGE,
  };
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve container workspace port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function runContainerCommand(
  runtime: ContainerConfig["runtime"],
  args: string[],
  allowFailure = false,
) {
  const proc = Bun.spawn([runtime, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0 && !allowFailure) {
    throw new Error(
      stderr.trim() || stdout.trim() || `${runtime} ${args.join(" ")} failed`,
    );
  }

  return {
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

function sanitizeContainerName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-");
}

async function waitForContainerServer(config: ContainerConfig) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    try {
      const response = await fetch(new URL("/event", config.serverUrl), {
        headers: {
          "x-nikcli-directory": config.directory,
        },
        signal: controller.signal,
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) return;
    } catch {
      // wait and retry while the container starts
    } finally {
      clearTimeout(timeout);
    }
    await Bun.sleep(500);
  }

  throw new Error(
    `Workspace container ${config.containerName} did not become ready in time`,
  );
}

const proxyBaseHeaders = new WeakMap<ContainerConfig, Headers>();

function baseProxyHeaders(config: ContainerConfig) {
  let cached = proxyBaseHeaders.get(config);
  if (!cached) {
    cached = new Headers({
      "x-nikcli-directory": config.directory,
    });
    proxyBaseHeaders.set(config, cached);
  }
  return cached;
}

function proxyHeaders(config: ContainerConfig, headers?: HeadersInit) {
  if (!headers) return new Headers(baseProxyHeaders(config));
  const next = new Headers(headers);
  next.delete("host");
  next.delete("content-length");
  next.delete("x-nikcli-workspace");
  if (!next.has("x-nikcli-directory"))
    next.set("x-nikcli-directory", config.directory);
  return next;
}

const ContainerAdaptor: Adaptor<ContainerConfig> = {
  name: "Container",
  description: "Docker/Podman container",
  async create(from, _branch, workspaceID) {
    const runtimeInfo = await getContainerRuntimeInfo();
    if (!runtimeInfo.available || !runtimeInfo.runtime) {
      throw new Error(
        "Container sandbox requires a healthy Docker or Podman runtime and a compatible Nikcli workspace image",
      );
    }
    const runtime = runtimeInfo.runtime;
    const imageSource = await resolveContainerImageSource();
    if (!imageSource)
      throw new Error("No Nikcli workspace container image is configured");
    const image = await ensureContainerImage(runtime, imageSource);

    const port = await reservePort();
    const containerName = sanitizeContainerName(
      workspaceID || `nikcli-mobile-${port}`,
    );
    const config: ContainerConfig = {
      type: "container",
      directory: from.directory,
      runtime,
      image: from.image || image,
      containerName,
      port,
      serverUrl: `http://127.0.0.1:${port}`,
      eventLimit: from.eventLimit,
    };

    return {
      config,
      init: async () => {
        await runContainerCommand(runtime, ["rm", "-f", containerName], true);
        await runContainerCommand(runtime, [
          "run",
          "-d",
          "--init",
          "--name",
          containerName,
          "-p",
          `127.0.0.1:${port}:${port}`,
          "-v",
          `${config.directory}:${config.directory}`,
          "-v",
          `${Global.Path.data}:${Global.Path.data}`,
          "-v",
          `${Global.Path.config}:${Global.Path.config}`,
          "-v",
          `${Global.Path.state}:${Global.Path.state}`,
          "-w",
          config.directory,
          config.image,
          "workspace-serve",
          "--hostname",
          "0.0.0.0",
          "--port",
          String(port),
        ]);
        try {
          await waitForContainerServer(config);
        } catch (error) {
          await runContainerCommand(runtime, ["rm", "-f", containerName], true);
          throw error;
        }
      },
    };
  },
  async remove(config) {
    await runContainerCommand(
      config.runtime,
      ["rm", "-f", config.containerName],
      true,
    );
  },
  target(config: ContainerConfig): Target {
    return {
      type: "remote",
      url: config.serverUrl,
      headers: proxyHeaders(config),
    };
  },
};

const adaptorRegistry = new Map<string, Adaptor<any>>();

export function registerAdaptor<T extends Config>(
  type: T["type"],
  adaptor: Adaptor<T>,
) {
  adaptorRegistry.set(type, adaptor as Adaptor<any>);
}

export function listAdaptors(): Array<{ type: string; adaptor: Adaptor<any> }> {
  const adaptors = new Map<string, Adaptor<any>>([
    ["worktree", WorktreeAdaptor as Adaptor<any>],
    ["container", ContainerAdaptor as Adaptor<any>],
  ]);
  for (const [type, adaptor] of adaptorRegistry) adaptors.set(type, adaptor);
  return Array.from(adaptors, ([type, adaptor]) => ({ type, adaptor }));
}

export function getAdaptor(config: Config): Adaptor {
  const custom = adaptorRegistry.get(config.type);
  if (custom) return custom as Adaptor;
  switch (config.type) {
    case "worktree":
      return WorktreeAdaptor;
    case "container":
      return ContainerAdaptor;
  }
}
