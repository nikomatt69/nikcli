#!/usr/bin/env bun
/**
 * computer-use CLI — every command except `bundle`/`install-skill` is a
 * thin RPC call against the per-workspace background daemon (auto-spawned on
 * first use). This is what lets `start`, then a later `wait`, then a later
 * `stop` work as three separate process invocations, e.g. from shell
 * scripts or CI steps — the same model as `@nikcli-ai/browser-control`'s
 * CLI.
 */
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import {
  ensureDaemon,
  rpc,
  shutdownDaemon,
  socketPathFor,
} from "./daemon-client";
import {
  createEvidenceBundle,
  type EvidenceBundleOptions,
  type VerificationResult,
} from "./evidence";
import type { SessionInfo } from "./session";
import type { JSONFrame } from "./render/json";

const HELP = `computer-use COMMAND [options]

Background desktop sessions, driven the way browser-control drives Chromium
pages — but for a real Linux desktop in a container, or the user's own
desktop in real time. A per-workspace daemon holds the desktop registry;
sessions persist across separate CLI invocations and the daemon exits on
its own after 10 idle minutes.

Session commands:
  computer-use start [NAME] [--mode sandbox|host] [--width N] [--height N]
  computer-use list
  computer-use info NAME
  computer-use capabilities NAME
  computer-use screenshot NAME [--out FILE]
  computer-use click NAME X Y [--button left|right|middle] [--double]
  computer-use drag NAME FROM_X FROM_Y TO_X TO_Y
  computer-use type NAME TEXT
  computer-use key NAME COMBO
  computer-use scroll NAME X Y (up|down|left|right) [--amount N]
  computer-use wait NAME (--text VALUE | --stable [--ms N] | --timeout MS) [--timeout MS]
  computer-use screen-size NAME
  computer-use stop NAME       stops the session but keeps the entry
                               queryable (e.g. for liveUrl) until removed
  computer-use remove NAME     forgets a stopped session
  computer-use restart NAME
  computer-use close-all

Recording:
  computer-use start-recording NAME [--fps N]

    --fps enables periodic real-screenshot sampling, usable for a video
    and for exact-marker frame lookup at any time — even before stop.
    Omit for markers-only recording.

  computer-use marker NAME LABEL
  computer-use stop-recording NAME
  computer-use recording-data NAME   current recording state, without stopping

Evidence:
  computer-use bundle (--screenshot FILE | --recording FILE) --out DIR --result passed|failed|unverified [options]

    --recording FILE takes JSON from \`stop-recording\`/\`recording-data\` and
    derives the screenshot/video from its sampled frames — mirrors
    browser-control's --at-marker/--at-ms capture-from-recording flow.

    Options:
      --at-marker NAME         with --recording: screenshot at this marker
      --at-ms MS                with --recording: screenshot nearest this timestamp
      --fps NUMBER              with --recording: video fps (default: as sampled)
      --title TEXT              PR section title
      --summary TEXT            Verification summary
      --link-base PATH          Repository-relative artifact path used by pr.md
      --no-preview              Do not produce an inline GIF preview
      --json                    Print the resulting bundle as JSON

Other:
  computer-use install-skill [--workspace DIR | --global] [--json]

    --global installs into ~/.agents/skills so nikcli discovers it in every
    workspace on this machine, not just the current one.
  computer-use shutdown        Stop the background daemon for this workspace
  -h, --help
`;

function take(args: string[], name: string): string {
  const value = args.shift();
  if (value === undefined || value.startsWith("--"))
    throw new Error(`${name} requires a value.`);
  return value;
}

function parseMode(value: string): "sandbox" | "host" {
  if (value === "sandbox" || value === "host") return value;
  throw new Error(`Invalid mode "${value}", expected sandbox or host.`);
}

class HelpRequested extends Error {}

async function withDaemon<T>(fn: (socket: string) => Promise<T>): Promise<T> {
  const socket = await socketPathFor();
  await ensureDaemon(socket);
  return fn(socket);
}

function printInfo(info: SessionInfo): void {
  process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
}

async function cmdStart(args: string[]): Promise<void> {
  let name: string | undefined;
  let mode: "sandbox" | "host" | undefined;
  let width: number | undefined;
  let height: number | undefined;
  if (args[0] && !args[0].startsWith("--")) name = args.shift();
  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--mode":
        mode = parseMode(take(args, arg));
        break;
      case "--width":
        width = Number(take(args, arg));
        break;
      case "--height":
        height = Number(take(args, arg));
        break;
      case "-h":
      case "--help":
        throw new HelpRequested();
      default:
        throw new Error(`Unknown start option: ${arg}`);
    }
  }
  const info = await withDaemon((socket) =>
    rpc<SessionInfo>(socket, "start", {
      nikcliSessionID: process.cwd(),
      name,
      mode,
      width,
      height,
    }),
  );
  printInfo(info);
}

async function cmdWait(name: string, args: string[]): Promise<void> {
  let condition: Record<string, unknown> | undefined;
  let timeout: number | undefined;
  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--text":
        condition = { type: "text", value: take(args, arg) };
        break;
      case "--stable":
        condition = { type: "stable" };
        break;
      case "--ms":
        if (condition?.type === "stable")
          condition.ms = Number(take(args, arg));
        else take(args, arg);
        break;
      case "--timeout":
        timeout = Number(take(args, arg));
        break;
      case "-h":
      case "--help":
        throw new HelpRequested();
      default:
        throw new Error(`Unknown wait option: ${arg}`);
    }
  }
  if (!condition) condition = { type: "timeout", ms: timeout ?? 1000 };
  else if (timeout !== undefined) condition.timeout = timeout;
  const result = await withDaemon((socket) =>
    rpc(socket, "wait", { name, condition }),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function cmdScreenshot(name: string, args: string[]): Promise<void> {
  let out: string | undefined;
  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--out":
        out = take(args, arg);
        break;
      case "-h":
      case "--help":
        throw new HelpRequested();
      default:
        throw new Error(`Unknown screenshot option: ${arg}`);
    }
  }
  const frame = await withDaemon((socket) =>
    rpc<JSONFrame>(socket, "screenshot", { name }),
  );
  if (!out) {
    process.stdout.write(`${JSON.stringify(frame, null, 2)}\n`);
    return;
  }
  await writeFile(out, Buffer.from(frame.screenshotBase64, "base64"));
  process.stdout.write(`${out}\n`);
}

export function renderAgentBundleOutput(
  bundle: Awaited<ReturnType<typeof createEvidenceBundle>>,
  prMarkdown: string,
): string {
  const preview = bundle.preview ?? bundle.screenshot;
  const previewUrl = pathToFileURL(preview).href;
  const lines = [
    "Computer evidence created.",
    "",
    `PR Markdown: ${bundle.prMarkdown}`,
    `Manifest: ${bundle.manifest}`,
    `Full MP4: ${bundle.video ?? "not generated"}`,
    "",
    "Inline preview (include this exact line in the assistant response):",
    `![Computer verification preview](<${previewUrl}>)`,
    "",
    "PR section:",
    prMarkdown.trimEnd(),
    "",
  ];
  return lines.join("\n");
}

function result(value: string): VerificationResult {
  if (value === "passed" || value === "failed" || value === "unverified")
    return value;
  throw new Error("--result must be passed, failed or unverified.");
}

export async function parseBundleOptions(
  argv: readonly string[],
): Promise<EvidenceBundleOptions & { readonly json: boolean }> {
  const args = [...argv];
  type MutableOptions = {
    -readonly [K in keyof EvidenceBundleOptions]?: EvidenceBundleOptions[K];
  };
  const options: MutableOptions & { json?: boolean } = {};
  let recordingPath: string | undefined;
  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--screenshot":
        options.screenshotPath = take(args, arg);
        break;
      case "--recording":
        recordingPath = take(args, arg);
        break;
      case "--at-marker":
        options.atMarker = take(args, arg);
        break;
      case "--at-ms":
        options.atMs = Number(take(args, arg));
        break;
      case "--fps":
        options.fps = Number(take(args, arg));
        break;
      case "--out":
        options.outputDirectory = take(args, arg);
        break;
      case "--result":
        options.result = result(take(args, arg));
        break;
      case "--title":
        options.title = take(args, arg);
        break;
      case "--summary":
        options.summary = take(args, arg);
        break;
      case "--link-base":
        options.linkBase = take(args, arg);
        break;
      case "--no-preview":
        options.preview = false;
        break;
      case "--json":
        options.json = true;
        break;
      case "-h":
      case "--help":
        throw new HelpRequested();
      default:
        throw new Error(`Unknown bundle option: ${arg}`);
    }
  }
  if (options.atMarker !== undefined && options.atMs !== undefined) {
    throw new Error(
      "Evidence capture accepts either atMarker or atMs, not both.",
    );
  }
  if (recordingPath) {
    options.recordingData = JSON.parse(
      await readFile(resolve(recordingPath), "utf8"),
    );
  }
  if (!options.screenshotPath && !options.recordingData) {
    throw new Error(
      "bundle requires --screenshot FILE or --recording FILE (from `stop-recording`/`recording-data`).",
    );
  }
  if (!options.outputDirectory) throw new Error("bundle requires --out DIR.");
  if (!options.result)
    throw new Error("bundle requires --result passed|failed|unverified.");
  return {
    ...options,
    outputDirectory: options.outputDirectory,
    result: options.result,
    json: options.json ?? false,
  };
}

// --- install-skill -----------------------------------------------------

export interface SkillInstallation {
  readonly source: string;
  readonly target: string;
  readonly installed: boolean;
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

async function findWorkspaceRoot(start = process.cwd()): Promise<string> {
  let current = resolve(start);
  while (true) {
    if (await lstat(join(current, ".git")).catch(() => undefined))
      return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

/**
 * `global: true` targets `~/.agents/skills/computer-use` — the home-rooted
 * external skill directory nikcli's Skill loader scans unconditionally for
 * every workspace on this machine, making the skill available by default
 * rather than opt-in per project. Mirrors browser-control's
 * install-skill exactly.
 */
export async function installWorkspaceSkill(
  workspace?: string,
  global?: boolean,
): Promise<SkillInstallation> {
  const root = global
    ? homedir()
    : workspace
      ? resolve(workspace)
      : await findWorkspaceRoot();
  const source = resolve(import.meta.dir, "../skills/computer-use");
  const sourceManifest = join(source, "SKILL.md");
  const target = join(root, ".agents/skills/computer-use");

  const manifest = await lstat(sourceManifest).catch(() => undefined);
  if (!manifest?.isFile())
    throw new Error(`Bundled computer-use skill is missing: ${sourceManifest}`);

  const existing = await lstat(target).catch(() => undefined);
  if (existing) {
    if (!existing.isSymbolicLink())
      throw new Error(
        `Skill target already exists and is not a symlink: ${target}`,
      );
    const linked = await readlink(target);
    const targetParent = await realpath(dirname(target)).catch(() =>
      dirname(target),
    );
    const linkedPath = resolve(targetParent, linked);
    const [actualSource, actualTarget] = await Promise.all([
      realpath(source).catch(() => source),
      realpath(linkedPath).catch(() => linkedPath),
    ]);
    if (!samePath(actualSource, actualTarget))
      throw new Error(
        `Skill target points somewhere else: ${target} -> ${linked}`,
      );
    return { source, target, installed: false };
  }

  await mkdir(dirname(target), { recursive: true });
  const targetParent = await realpath(dirname(target)).catch(() =>
    dirname(target),
  );
  const link = relative(targetParent, source) || ".";
  await symlink(
    link,
    target,
    process.platform === "win32" ? "junction" : "dir",
  );
  return { source, target, installed: true };
}

function parseInstallOptions(argv: readonly string[]): {
  workspace?: string;
  global: boolean;
  json: boolean;
} {
  const args = [...argv];
  let workspace: string | undefined;
  let global = false;
  let json = false;
  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--workspace":
        workspace = take(args, arg);
        break;
      case "--global":
        global = true;
        break;
      case "--json":
        json = true;
        break;
      case "-h":
      case "--help":
        throw new HelpRequested();
      default:
        throw new Error(`Unknown install-skill option: ${arg}`);
    }
  }
  return { ...(workspace ? { workspace } : {}), global, json };
}

// --- main ----------------------------------------------------------------

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;
  const args = [...rest];

  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    process.stdout.write(HELP);
    return;
  }

  try {
    switch (command) {
      case "start":
        return await cmdStart(args);
      case "list": {
        const list = await withDaemon((socket) =>
          rpc<SessionInfo[]>(socket, "list"),
        );
        process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
        return;
      }
      case "info": {
        const name = take(args, "info");
        printInfo(
          await withDaemon((socket) =>
            rpc<SessionInfo>(socket, "info", { name }),
          ),
        );
        return;
      }
      case "capabilities": {
        const name = take(args, "capabilities");
        const info = await withDaemon((socket) =>
          rpc<SessionInfo>(socket, "info", { name }),
        );
        process.stdout.write(
          `mode: ${info.mode}\nstatus: ${info.status}\nscreen: ${info.screen.width}x${info.screen.height}\nlive preview: ${
            info.liveUrl ?? "(none)"
          }\n`,
        );
        return;
      }
      case "screenshot":
        return await cmdScreenshot(take(args, "screenshot"), args);
      case "click": {
        const name = take(args, "click");
        const x = Number(take(args, "click"));
        const y = Number(take(args, "click"));
        let button: "left" | "right" | "middle" = "left";
        let double = false;
        while (args.length > 0) {
          const arg = args.shift()!;
          if (arg === "--button")
            button = take(args, arg) as "left" | "right" | "middle";
          else if (arg === "--double") double = true;
          else if (arg === "-h" || arg === "--help") throw new HelpRequested();
          else throw new Error(`Unknown click option: ${arg}`);
        }
        printInfo(
          await withDaemon((socket) =>
            rpc<SessionInfo>(socket, "click", {
              name,
              point: { x, y },
              button,
              double,
            }),
          ),
        );
        return;
      }
      case "drag": {
        const name = take(args, "drag");
        const from = {
          x: Number(take(args, "drag")),
          y: Number(take(args, "drag")),
        };
        const to = {
          x: Number(take(args, "drag")),
          y: Number(take(args, "drag")),
        };
        printInfo(
          await withDaemon((socket) =>
            rpc<SessionInfo>(socket, "drag", { name, from, to }),
          ),
        );
        return;
      }
      case "type": {
        const name = take(args, "type");
        const text = take(args, "type");
        printInfo(
          await withDaemon((socket) =>
            rpc<SessionInfo>(socket, "type", { name, text }),
          ),
        );
        return;
      }
      case "key": {
        const name = take(args, "key");
        const combo = take(args, "key");
        printInfo(
          await withDaemon((socket) =>
            rpc<SessionInfo>(socket, "key", { name, combo }),
          ),
        );
        return;
      }
      case "scroll": {
        const name = take(args, "scroll");
        const x = Number(take(args, "scroll"));
        const y = Number(take(args, "scroll"));
        const direction = take(args, "scroll") as
          | "up"
          | "down"
          | "left"
          | "right";
        let amount = 3;
        while (args.length > 0) {
          const arg = args.shift()!;
          if (arg === "--amount") amount = Number(take(args, arg));
          else if (arg === "-h" || arg === "--help") throw new HelpRequested();
          else throw new Error(`Unknown scroll option: ${arg}`);
        }
        printInfo(
          await withDaemon((socket) =>
            rpc<SessionInfo>(socket, "scroll", {
              name,
              point: { x, y },
              direction,
              amount,
            }),
          ),
        );
        return;
      }
      case "wait":
        return await cmdWait(take(args, "wait"), args);
      case "screen-size": {
        const name = take(args, "screen-size");
        const size = await withDaemon((socket) =>
          rpc<{ width: number; height: number }>(socket, "screenSize", {
            name,
          }),
        );
        process.stdout.write(`${size.width}x${size.height}\n`);
        return;
      }
      case "stop": {
        const name = take(args, "stop");
        await withDaemon((socket) => rpc(socket, "stop", { name }));
        process.stdout.write(`Stopped: ${name}\n`);
        return;
      }
      case "remove": {
        const name = take(args, "remove");
        await withDaemon((socket) => rpc(socket, "remove", { name }));
        process.stdout.write(`Removed: ${name}\n`);
        return;
      }
      case "restart": {
        const name = take(args, "restart");
        printInfo(
          await withDaemon((socket) =>
            rpc<SessionInfo>(socket, "restart", {
              nikcliSessionID: process.cwd(),
              name,
            }),
          ),
        );
        return;
      }
      case "close-all": {
        const socket = await socketPathFor();
        await shutdownDaemon(socket);
        process.stdout.write("Closed all sessions and stopped the daemon.\n");
        return;
      }
      case "start-recording": {
        const name = take(args, "start-recording");
        let sampleFps: number | undefined;
        while (args.length > 0) {
          const arg = args.shift()!;
          if (arg === "--fps") sampleFps = Number(take(args, arg));
          else if (arg === "-h" || arg === "--help") throw new HelpRequested();
          else throw new Error(`Unknown start-recording option: ${arg}`);
        }
        await withDaemon((socket) =>
          rpc(socket, "startRecording", { name, sampleFps }),
        );
        process.stdout.write(
          `Recording: ${name}${sampleFps ? ` @ ${sampleFps}fps` : ""}\n`,
        );
        return;
      }
      case "marker": {
        const name = take(args, "marker");
        const markerName = take(args, "marker");
        const marker = await withDaemon((socket) =>
          rpc(socket, "marker", { name, markerName }),
        );
        process.stdout.write(`${JSON.stringify(marker, null, 2)}\n`);
        return;
      }
      case "stop-recording": {
        const name = take(args, "stop-recording");
        const data = await withDaemon((socket) =>
          rpc(socket, "stopRecording", { name }),
        );
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
        return;
      }
      case "recording-data": {
        const name = take(args, "recording-data");
        const data = await withDaemon((socket) =>
          rpc(socket, "recordingData", { name }),
        );
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
        return;
      }
      case "shutdown": {
        const socket = await socketPathFor();
        await shutdownDaemon(socket);
        process.stdout.write("Daemon stopped.\n");
        return;
      }
      case "install-skill": {
        const options = parseInstallOptions(args);
        const installation = await installWorkspaceSkill(
          options.workspace,
          options.global,
        );
        if (options.json) {
          process.stdout.write(`${JSON.stringify(installation, null, 2)}\n`);
          return;
        }
        const action = installation.installed
          ? "Installed"
          : "Already installed";
        process.stdout.write(
          `${action}: ${installation.target}\nRestart nikcli to load the skill.\n`,
        );
        return;
      }
      case "bundle": {
        const { json, ...options } = await parseBundleOptions(args);
        const bundle = await createEvidenceBundle(options);
        if (json) {
          process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
          return;
        }
        const prMarkdown = await readFile(bundle.prMarkdown, "utf8");
        process.stdout.write(renderAgentBundleOutput(bundle, prMarkdown));
        return;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(HELP);
      return;
    }
    throw error;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
