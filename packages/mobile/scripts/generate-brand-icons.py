#!/usr/bin/env python3
"""Generate nikcli brand icons from the wordmark aesthetic."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

# Wordmark palette: NIK gray body + CLI light traces on black.
BG = (0, 0, 0, 255)
BODY = (117, 117, 117, 255)  # medium gray (NIK)
TRACE_1 = (90, 90, 90, 255)
TRACE_2 = (168, 168, 168, 255)
TRACE_3 = (220, 220, 220, 255)

# Blocky "N" on a 7x9 grid (x, y) with stepped diagonal.
N_BLOCKS = {
    (0, 0),
    (0, 1),
    (0, 2),
    (0, 3),
    (0, 4),
    (0, 5),
    (0, 6),
    (0, 7),
    (0, 8),
    (1, 1),
    (2, 2),
    (3, 3),
    (4, 4),
    (5, 5),
    (6, 4),
    (6, 5),
    (6, 6),
    (6, 7),
    (6, 8),
    (6, 0),
    (6, 1),
    (6, 2),
    (6, 3),
}


def draw_mark(size: int, block: int, trace: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)

    grid_w, grid_h = 7, 9
    pad = (size - grid_w * block) // 2
    pad_y = (size - grid_h * block) // 2

    def block_rects(offset: int) -> list[tuple[int, int, int, int]]:
        rects: list[tuple[int, int, int, int]] = []
        for x, y in N_BLOCKS:
            x0 = pad + x * block + offset
            y0 = pad_y + y * block + offset
            rects.append((x0, y0, x0 + block - 1, y0 + block - 1))
        return rects

    for color, offset in (
        (TRACE_1, trace * 3),
        (TRACE_2, trace * 2),
        (TRACE_3, trace),
    ):
        for rect in block_rects(offset):
            draw.rectangle(rect, outline=color, width=max(1, block // 5))

    for rect in block_rects(0):
        draw.rectangle(rect, fill=BODY)

    return img


def save_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)


def main() -> None:
    icon = draw_mark(1024, block=88, trace=10)
    mark = draw_mark(128, block=11, trace=1)
    favicon = draw_mark(48, block=4, trace=1)

    save_png(icon, ASSETS / "icon.png")
    save_png(icon, ASSETS / "adaptive-icon.png")
    save_png(icon, ASSETS / "splash.png")
    save_png(mark, ASSETS / "app-icon-mark.png")
    save_png(favicon, ASSETS / "favicon.png")

    print("Wrote brand icons to", ASSETS)


if __name__ == "__main__":
    main()
