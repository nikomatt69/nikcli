import { describe, expect, test } from "bun:test";
import {
  encodeAsciiBlocks,
  encodeBraille,
  encodeHalfblock,
  encodeIterm2,
  encodeIterm2Bytes,
  encodeKitty,
  encodeSixel,
} from "../src/encode";
import { checkeredImage, solidImage } from "./_fixtures";
import { setPixel } from "../src/pixels";

describe("encodeKitty", () => {
  test("emits an APC G command with chunked base64 PNG", () => {
    const image = checkeredImage(8, 8);
    const out = encodeKitty(image, { columns: 8, rows: 8 });
    // APC introducer + Kitty 'G' command.
    expect(out).toMatch(/\x1b_G/);
    // Should end with a 'put' (a=p) command referencing the image id.
    expect(out).toMatch(/a=p/);
    // PNG format flag.
    expect(out).toMatch(/f=100/);
  });

  test("emits raw RGBA chunks when format='rgba'", () => {
    const image = checkeredImage(2, 2);
    const out = encodeKitty(image, { format: "rgba", columns: 2, rows: 2 });
    expect(out).toMatch(/f=24/);
  });
});

describe("encodeIterm2", () => {
  test("emits an OSC 1337 file payload", () => {
    const image = checkeredImage(4, 4);
    const out = encodeIterm2(image, { width: 4, height: 4 });
    expect(out.startsWith("\x1b]1337;")).toBe(true);
    expect(out).toMatch(/file=\d+/);
    expect(out).toMatch(/inline=1/);
  });

  test("forwards compressed image bytes without re-encoding", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const out = encodeIterm2Bytes(bytes, { width: 20, height: 10 });
    expect(out).toContain("file=4;width=20;height=10");
    expect(out).toContain(Buffer.from(bytes).toString("base64"));
  });
});

describe("encodeSixel", () => {
  test("emits a Sixel stream with introducer and terminator", () => {
    const image = checkeredImage(6, 6);
    const out = encodeSixel(image);
    expect(out[0]).toBe(0x1b);
    expect(out[1]).toBe(0x50); // 'P'
    expect(out[2]).toBe(0x71); // 'q'
    expect(out[out.length - 2]).toBe(0x1b);
    expect(out[out.length - 1]).toBe(0x5c);
  });
});

describe("encodeHalfblock", () => {
  test("emits the requested number of lines", () => {
    const image = checkeredImage(20, 10);
    const out = encodeHalfblock(image, { columns: 20, rows: 5 });
    const lines = out.split("\n");
    expect(lines.length).toBe(5);
    // Every non-reset cell should include a half-block character.
    expect(out).toContain("\u2580");
  });
});

describe("encodeBraille", () => {
  test("emits one line per row and uses Unicode braille characters", () => {
    const image = checkeredImage(8, 8);
    const out = encodeBraille(image, { columns: 4, rows: 2 });
    const lines = out.split("\n");
    expect(lines.length).toBe(2);
    // Every non-SGR, non-newline character should be a Braille glyph
    // (U+2800..U+28FF). The encoder wraps each cell in an SGR sequence for
    // fg/bg colours, so we walk past them.
    let i = 0;
    let brailleCount = 0;
    while (i < out.length) {
      const ch = out[i]!;
      if (ch === "\n") {
        i += 1;
        continue;
      }
      if (ch === "\x1b") {
        const end = out.indexOf("m", i + 1);
        if (end === -1) break;
        i = end + 1;
        continue;
      }
      const code = ch.charCodeAt(0);
      expect(code).toBeGreaterThanOrEqual(0x2800);
      expect(code).toBeLessThanOrEqual(0x28ff);
      brailleCount += 1;
      i += 1;
    }
    expect(brailleCount).toBeGreaterThan(0);
  });

  test("preserves a thin high-contrast detail in the braille mask", () => {
    const image = solidImage(2, 4, 0, 0, 0);
    setPixel(image, 0, 0, [255, 255, 255, 255]);
    const out = encodeBraille(image, { columns: 1, rows: 1 });
    expect(out).toContain("\u2801");
  });
});

describe("encodeAsciiBlocks", () => {
  test("emits ASCII-only output", () => {
    const image = solidImage(20, 10, 255, 255, 255);
    const out = encodeAsciiBlocks(image, { columns: 10, rows: 5 });
    const lines = out.split("\n");
    expect(lines.length).toBe(5);
    for (const line of lines) {
      expect(line).toMatch(/^[ .:=+*#%@]+$/);
    }
  });

  test("uses pure black for black pixels", () => {
    const image = solidImage(4, 4, 0, 0, 0);
    const out = encodeAsciiBlocks(image, { columns: 4, rows: 4 });
    expect(
      out
        .trim()
        .split("\n")
        .every((line) => line.trim() === ""),
    ).toBe(true);
  });

  test("uses bright char for bright pixels", () => {
    const image = solidImage(4, 4, 255, 255, 255);
    const out = encodeAsciiBlocks(image, { columns: 4, rows: 4 });
    expect(
      out
        .trim()
        .split("\n")
        .every((line) => line.trim() === "@".repeat(4)),
    ).toBe(true);
  });
});
