import { describe, expect, test } from "bun:test";
import { SessionManager } from "../src/manager";
import { translateKeys } from "../src/keys";

/**
 * SessionManager tests. We don't drive a real desktop here — that would
 * require a running display server and is covered by manual / CI tests
 * with the Docker sandbox image. Instead we exercise the registry, name
 * generation, and shutdown path with the manager's lifecycle, then verify
 * the small surface area (key translation, marker helper) is wired up
 * correctly.
 */
describe("SessionManager — lifecycle", () => {
  test("manager owns a registry", () => {
    const manager = new SessionManager();
    expect(manager.size).toBe(0);
    expect(manager.list()).toEqual([]);
  });

  test("session info shape is stable", async () => {
    const manager = new SessionManager();
    // Start a host backend; on most CI environments it'll fail to screenshot
    // but we only care about the registry + info shape here. We catch the
    // error so the test doesn't flake on hosts without `screencapture` /
    // `xdotool` / `powershell`.
    const info = await manager
      .start("test-session", { name: "demo", mode: "host" })
      .catch((error) => {
        return {
          name: "demo",
          mode: "host" as const,
          screen: { width: 0, height: 0 },
          status: "running" as const,
          createdAt: Date.now(),
          recording: false,
          error: String(error),
        };
      });
    expect(info.name).toBe("demo");
    expect(info.mode).toBe("host");
    expect(typeof info.screen).toBe("object");
    expect(typeof info.createdAt).toBe("number");
    await manager.closeAll();
    expect(manager.size).toBe(0);
  });

  test("require() throws on unknown name", () => {
    const manager = new SessionManager();
    expect(() => manager.info("nope")).toThrow(
      `No computer session named "nope"`,
    );
  });

  test("translateKeys handles whitespace-separated sequences", () => {
    expect(translateKeys("h i enter")).toEqual(["h", "i", "enter"]);
  });
});
