import { describe, expect, test } from "bun:test";
import {
  detectCapabilities,
  Protocol,
  protocolForTerminal,
} from "../src/capabilities";

describe("protocolForTerminal", () => {
  test("recognises kitty", () => {
    expect(protocolForTerminal("xterm-kitty", undefined)).toBe(Protocol.KITTY);
  });

  test("recognises ghostty", () => {
    expect(protocolForTerminal("ghostty", undefined)).toBe(Protocol.KITTY);
  });

  test("recognises wezterm", () => {
    expect(protocolForTerminal("WezTerm", undefined)).toBe(Protocol.KITTY);
  });

  test("recognises iterm2", () => {
    expect(protocolForTerminal("iTerm.app", undefined)).toBe(Protocol.ITERM2);
  });

  test("recognises vscode", () => {
    expect(protocolForTerminal("vscode", undefined)).toBe(Protocol.ITERM2);
  });

  test("recognises xterm (sixel)", () => {
    expect(protocolForTerminal("xterm-256color", undefined)).toBe(
      Protocol.SIXEL,
    );
  });

  test("returns null on unknown", () => {
    expect(protocolForTerminal(null, undefined)).toBeNull();
    expect(protocolForTerminal("dumb", undefined)).toBeNull();
  });
});

describe("detectCapabilities", () => {
  test("honours KITTY_WINDOW_ID", () => {
    const caps = detectCapabilities(undefined, { KITTY_WINDOW_ID: "1" });
    expect(caps.kitty).toBe(true);
    expect(caps.best).toBe(Protocol.KITTY);
  });

  test("honours GHOSTTY_RESOURCES_DIR", () => {
    const caps = detectCapabilities(undefined, {
      GHOSTTY_RESOURCES_DIR: "/tmp",
    });
    expect(caps.kitty).toBe(true);
  });

  test("honours ITERM_SESSION_ID", () => {
    const caps = detectCapabilities(undefined, { ITERM_SESSION_ID: "abc" });
    expect(caps.iterm2).toBe(true);
  });

  test("honours WT_SESSION as sixel", () => {
    const caps = detectCapabilities(undefined, { WT_SESSION: "abc" });
    expect(caps.sixel).toBe(true);
  });

  test("honours KONSOLE_VERSION >= 22 for kitty, < 22 for sixel", () => {
    const old = detectCapabilities(undefined, { KONSOLE_VERSION: "21.12.4" });
    expect(old.sixel).toBe(true);
    expect(old.kitty).toBe(false);
    const recent = detectCapabilities(undefined, {
      KONSOLE_VERSION: "23.05.0",
    });
    expect(recent.kitty).toBe(true);
  });

  test("strips iterm2 on stderr", () => {
    const caps = detectCapabilities(
      { kind: "stderr" },
      { ITERM_SESSION_ID: "abc" },
    );
    expect(caps.iterm2).toBe(false);
  });

  test("order is kitty > sixel > iterm2", () => {
    const caps = detectCapabilities(undefined, {
      KITTY_WINDOW_ID: "1",
      ITERM_SESSION_ID: "x",
    });
    expect(caps.available[0]).toBe(Protocol.KITTY);
    expect(caps.available).toContain(Protocol.ITERM2);
  });
});
