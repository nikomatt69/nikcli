/**
 * Kitty smoke test for the browser live view.
 *
 * The one genuinely uncertain assumption behind `specs/browser-live-view.md` is
 * that a Kitty *virtual placement* (`U=1`, composited over placeholder cells)
 * can be fed by a *temporary-file* transmission (`t=t`, where only a path
 * crosses the PTY). Both are documented, they are independent keys of the same
 * APC command, and nothing in the spec says they can't be combined — but no
 * terminal promises it either, and the whole frame path is built on top.
 *
 * So: verify it before building on it. This script drives a real page through
 * the real screencast into the real terminal, deliberately without OpenTUI, so
 * that what you see is the graphics protocol and nothing else.
 *
 *   bun packages/nikcli/script/browser-kitty-smoke.ts [url] [--inline] [--fps 12]
 *
 * Expected: a live, moving page filling the terminal. `--inline` renders the
 * same stream with base64-through-the-PTY transmission; if that works and the
 * default doesn't, `t=t` is the unsupported half and layer 2's `file` mode has
 * to stop being the default.
 *
 * Keys: q / ctrl-c quit · arrows and j/k scroll · r reload.
 */
import {
  encodeKittyVirtualFile,
  encodeKittyVirtualPng,
  kittyIdColor,
  kittyPlaceholderGrid,
} from "@nikcli-ai/tui-image";
import {
  ensureDaemon,
  openScreencast,
  rpc,
  socketPathFor,
} from "@nikcli-ai/browser-control/daemon-client";

const DEFAULT_CELL_WIDTH = 10;
const DEFAULT_CELL_HEIGHT = 20;
const IMAGE_ID = 0x515157;
const STATUS_ROWS = 1;

const argv = Bun.argv.slice(2);
const inline = argv.includes("--inline");
const fpsIndex = argv.indexOf("--fps");
const fps = fpsIndex === -1 ? 12 : Number(argv[fpsIndex + 1]) || 12;
const url =
  argv.find((arg) => !arg.startsWith("--") && arg !== String(fps)) ??
  "https://example.com";

const out = (value: string) => process.stdout.write(value);

/**
 * Ask the terminal for its cell size in pixels (CSI 16 t → CSI 6 ; h ; w t).
 * Every mapping in the live view — viewport size, click coordinates — is
 * derived from this, so guessing is a last resort rather than the plan.
 */
async function cellSize(): Promise<{
  width: number;
  height: number;
  measured: boolean;
}> {
  if (!process.stdin.isTTY)
    return {
      width: DEFAULT_CELL_WIDTH,
      height: DEFAULT_CELL_HEIGHT,
      measured: false,
    };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  out("\x1b[16t");
  const answer = await new Promise<string>((resolve) => {
    let buffer = "";
    const timer = setTimeout(() => {
      process.stdin.off("data", onData);
      resolve("");
    }, 300);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("latin1");
      if (!buffer.includes("t")) return;
      clearTimeout(timer);
      process.stdin.off("data", onData);
      resolve(buffer);
    };
    process.stdin.on("data", onData);
  });
  const match = new RegExp(
    `${String.fromCharCode(27)}\\[6;(\\d+);(\\d+)t`,
  ).exec(answer);
  if (!match)
    return {
      width: DEFAULT_CELL_WIDTH,
      height: DEFAULT_CELL_HEIGHT,
      measured: false,
    };
  return { width: Number(match[2]), height: Number(match[1]), measured: true };
}

const cell = await cellSize();
const columns = process.stdout.columns ?? 80;
const rows = Math.max(1, (process.stdout.rows ?? 24) - STATUS_ROWS);
const viewport = { width: columns * cell.width, height: rows * cell.height };

const socket = await socketPathFor(process.cwd());
await ensureDaemon(socket);
const name = `kitty-smoke-${process.pid}`;
await rpc(socket, "start", { name, url, viewport });

const abort = new AbortController();
let frames = 0;
let dropped = 0;
let bytes = 0;
let lastError = "";

const status = (message: string) => {
  const line = message.slice(0, columns).padEnd(columns);
  out(`\x1b[${rows + 1};1H\x1b[7m${line}\x1b[0m`);
};

function enterFullScreen() {
  out("\x1b[?1049h"); // alternate screen
  out("\x1b[?25l"); // hide cursor
  out("\x1b[2J"); // clear
  // The placeholder grid is written once: the cells never change, only the
  // image behind them does. That is the whole reason this scales to video.
  const color = kittyIdColor(IMAGE_ID);
  const grid = kittyPlaceholderGrid(columns, rows);
  out("\x1b[1;1H");
  out(`\x1b[38;2;${color.r};${color.g};${color.b}m`);
  for (let i = 0; i < grid.length; i++) out(`\x1b[${i + 1};1H${grid[i]}`);
  out("\x1b[0m");
}

function leaveFullScreen() {
  out(`\x1b_Ga=d,d=I,i=${IMAGE_ID},q=2\x1b\\`);
  out("\x1b[?25h");
  out("\x1b[?1049l");
}

let closing = false;
async function shutdown(reason: string) {
  if (closing) return;
  closing = true;
  abort.abort();
  await rpc(socket, "remove", { name }).catch(() => {});
  leaveFullScreen();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write(
    `\n${reason}\n` +
      `  transmission : ${inline ? "inline (t=d)" : "temporary file (t=t)"}\n` +
      `  cell size    : ${cell.width}x${cell.height}px ${cell.measured ? "(measured)" : "(assumed — terminal did not answer CSI 16t)"}\n` +
      `  placement    : ${columns}x${rows} cells → ${viewport.width}x${viewport.height}px\n` +
      `  frames       : ${frames} shown, ${dropped} dropped, ${(bytes / 1024).toFixed(0)}KiB through the PTY\n` +
      (lastError ? `  last error   : ${lastError}\n` : "") +
      `\nIf the page rendered and moved, the assumption holds.\n`,
  );
  process.exit(0);
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (chunk: Buffer) => {
    const key = chunk.toString("latin1");
    if (key === "q" || key === "\x03") return void shutdown("Stopped.");
    if (key === "r")
      return void rpc(socket, "reload", { name }).catch(() => {});
    const scroll =
      key === "\x1b[B" || key === "j"
        ? 120
        : key === "\x1b[A" || key === "k"
          ? -120
          : key === " "
            ? 400
            : 0;
    if (scroll !== 0) {
      void rpc(socket, "pointer", {
        name,
        input: {
          type: "wheel",
          x: viewport.width / 2,
          y: viewport.height / 2,
          deltaY: scroll,
        },
      }).catch(() => {});
    }
  });
}
process.on("SIGINT", () => void shutdown("Interrupted."));
process.on("SIGTERM", () => void shutdown("Terminated."));

enterFullScreen();
status(
  ` ${inline ? "inline" : "t=t"} · ${columns}x${rows} cells · waiting for first frame… · q to quit `,
);

try {
  for await (const frame of openScreencast(socket, {
    name,
    mode: inline ? "inline" : "file",
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    fps,
    signal: abort.signal,
  })) {
    if (closing) break;
    dropped += Math.max(0, frame.seq - frames - dropped - 1);
    frames++;

    const command =
      inline || !frame.path
        ? encodeKittyVirtualPng(Uint8Array.fromBase64(frame.pngBase64 ?? ""), {
            id: IMAGE_ID,
            columns,
            rows,
          })
        : encodeKittyVirtualFile(frame.path, { id: IMAGE_ID, columns, rows });
    bytes += command.length;
    out(command);
    status(
      ` ${inline ? "inline" : "t=t"} · ${frame.width}x${frame.height}px · frame ${frames} (${dropped} dropped) · ${(bytes / 1024).toFixed(0)}KiB PTY · q quit `,
    );
  }
} catch (error) {
  if (!abort.signal.aborted)
    lastError = error instanceof Error ? error.message : String(error);
}

await shutdown(lastError ? "Stream failed." : "Stream ended.");
