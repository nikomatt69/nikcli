import { describe, expect, test } from "bun:test";
import { translateKey, translateKeys } from "../src/keys";

describe("translateKey", () => {
  test("single named keys", () => {
    expect(translateKey("enter")).toBe("enter");
    expect(translateKey("Escape")).toBe("escape");
    expect(translateKey("tab")).toBe("tab");
    expect(translateKey("F5")).toBe("f5");
  });

  test("modifier chords normalize to canonical order", () => {
    expect(translateKey("cmd+a")).toBe("cmd+a");
    expect(translateKey("shift+ctrl+alt+x")).toBe("ctrl+alt+shift+x");
    expect(translateKey("Control+Alt+Delete")).toBe("ctrl+alt+delete");
  });

  test("modifier aliases collapse", () => {
    expect(translateKey("command+a")).toBe("cmd+a");
    expect(translateKey("option+tab")).toBe("alt+tab");
    expect(translateKey("c+a")).toBe("ctrl+a");
  });

  test("unknown single characters pass through", () => {
    expect(translateKey("a")).toBe("a");
    expect(translateKey("Z")).toBe("Z");
  });
});

describe("translateKeys", () => {
  test("splits on whitespace", () => {
    expect(translateKeys("h i enter")).toEqual(["h", "i", "enter"]);
  });

  test("empty input is empty output", () => {
    expect(translateKeys("")).toEqual([]);
  });

  test("complex sequences", () => {
    expect(translateKeys("cmd+a ctrl+c enter")).toEqual([
      "cmd+a",
      "ctrl+c",
      "enter",
    ]);
  });
});
