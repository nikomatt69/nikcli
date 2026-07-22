import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

async function workspaceRoot(start = process.cwd()): Promise<string> {
  let current = resolve(start);
  while (true) {
    if (await lstat(join(current, ".git")).catch(() => undefined))
      return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export async function socketPathFor(workspace?: string) {
  const root = workspace ? resolve(workspace) : await workspaceRoot();
  return join(
    tmpdir(),
    `native-control-${createHash("sha1").update(root).digest("hex").slice(0, 16)}.sock`,
  );
}

async function alive(socket: string) {
  try {
    return (
      await fetch("http://localhost/health", {
        unix: socket,
        signal: AbortSignal.timeout(500),
      } as RequestInit)
    ).ok;
  } catch {
    return false;
  }
}

export async function ensureDaemon(socket: string) {
  if (await alive(socket)) return;
  const child = Bun.spawn(
    ["bun", resolve(import.meta.dir, "daemon.ts"), "--socket", socket],
    {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (await alive(socket)) return;
    await Bun.sleep(100);
  }
  throw new Error(`native-control daemon did not start on ${socket}`);
}

export async function rpc<T>(
  socket: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("http://localhost/rpc", {
    method: "POST",
    unix: socket,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  } as RequestInit);
  const body = (await response.json()) as {
    ok: boolean;
    result?: T;
    error?: string;
  };
  if (!body.ok)
    throw new Error(body.error ?? `native-control RPC ${method} failed`);
  return body.result as T;
}

export async function shutdownDaemon(socket: string) {
  if (await alive(socket))
    await fetch("http://localhost/shutdown", {
      method: "POST",
      unix: socket,
    } as RequestInit).catch(() => undefined);
}
