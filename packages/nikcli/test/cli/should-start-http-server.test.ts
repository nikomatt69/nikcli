import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

const testHome = await fs.mkdtemp(
  path.join(os.tmpdir(), "nikcli-should-start-home-"),
);
process.env.NIKCLI_TEST_HOME = testHome;
process.env.XDG_CONFIG_HOME = path.join(testHome, "xdg-config");
await fs.mkdir(path.join(process.env.XDG_CONFIG_HOME, "nikcli"), {
  recursive: true,
});

const { Global } = await import("@/global");
const { resolveNetworkOptions, shouldStartHttpServer, isLoopbackHostname } =
  await import("@/cli/network");

const globalConfigPath = path.join(Global.Path.config, "nikcli.json");

async function writeGlobalConfig(content: Record<string, unknown>) {
  await fs.mkdir(Global.Path.config, { recursive: true });
  await Bun.write(globalConfigPath, JSON.stringify(content, null, 2));
}

afterAll(async () => {
  await fs.rm(testHome, { recursive: true, force: true });
});

describe("isLoopbackHostname", () => {
  it("recognizes loopback hosts", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("192.168.1.1")).toBe(false);
  });
});

describe("shouldStartHttpServer", () => {
  let savedArgv: string[];

  beforeEach(async () => {
    savedArgv = [...process.argv];
    delete process.env.PORT;
    await writeGlobalConfig({});
  });

  afterEach(() => {
    process.argv = savedArgv;
    delete process.env.PORT;
  });

  it("is false for default loopback with port 0 and no mdns", async () => {
    process.argv = ["bun", "cli"];
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    });
    expect(shouldStartHttpServer(r)).toBe(false);
  });

  it("is true when config sets a fixed port", async () => {
    process.argv = ["bun", "cli"];
    await writeGlobalConfig({ server: { port: 9000 } });
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    });
    expect(r.port).toBe(9000);
    expect(shouldStartHttpServer(r)).toBe(true);
  });

  it("is true when config enables mdns (hostname becomes 0.0.0.0)", async () => {
    process.argv = ["bun", "cli"];
    await writeGlobalConfig({ server: { mdns: true } });
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    });
    expect(r.mdns).toBe(true);
    expect(r.hostname).toBe("0.0.0.0");
    expect(shouldStartHttpServer(r)).toBe(true);
  });

  it("is true when config sets a non-loopback hostname", async () => {
    process.argv = ["bun", "cli"];
    await writeGlobalConfig({ server: { hostname: "192.168.1.1" } });
    const r = await resolveNetworkOptions({
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    });
    expect(r.hostname).toBe("192.168.1.1");
    expect(shouldStartHttpServer(r)).toBe(true);
  });

  it("is true when argv passes --port", async () => {
    process.argv = ["bun", "cli", "--port", "3000"];
    const r = await resolveNetworkOptions({
      port: 3000,
      hostname: "127.0.0.1",
      mdns: false,
      cors: [],
    });
    expect(r.port).toBe(3000);
    expect(shouldStartHttpServer(r)).toBe(true);
  });
});
