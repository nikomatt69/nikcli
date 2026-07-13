#!/usr/bin/env python3
"""Generate nikcli brand icons + themed splash screens from the wordmark."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
# Optional high-res mark source produced by design tooling / GenerateImage.
MARK_CANDIDATES = [
    Path.home() / ".cursor/projects/Volumes-SSD-Projects-nikcli/assets/nikcli-icon-mark-source.png",
    ASSETS / "icon-dark.png",
]


def ensure_rgba(img: Image.Image) -> Image.Image:
    return img.convert("RGBA")


def trim_content(img: Image.Image, pad: int = 8) -> Image.Image:
    px = img.load()
    w, h = img.size
    min_x, min_y, max_x, max_y = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 20 and (r + g + b) > 40:
                found = True
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if not found:
        return img
    return img.crop(
        (
            max(0, min_x - pad),
            max(0, min_y - pad),
            min(w, max_x + 1 + pad),
            min(h, max_y + 1 + pad),
        )
    )


def fit_on_canvas(
    src: Image.Image,
    size: int,
    bg: tuple[int, int, int, int],
    margin_ratio: float,
) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg)
    max_side = int(size * (1 - 2 * margin_ratio))
    w, h = src.size
    scale = min(max_side / w, max_side / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def recolor_mark_for_light(img: Image.Image) -> Image.Image:
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    src = img.load()
    dst = out.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = src[x, y]
            if a < 10:
                continue
            lum = (r + g + b) / 3
            if lum < 28:
                continue
            ink = int(max(28, min(110, 255 - lum * 0.95)))
            dst[x, y] = (ink, ink, ink, 255)
    return out


def compose_splash(wordmark_path: Path, bg: tuple[int, int, int, int], size: int = 1024) -> Image.Image:
    wm = ensure_rgba(Image.open(wordmark_path))
    px = wm.load()
    w, h = wm.size
    min_x, min_y, max_x, max_y = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 20 and (r + g + b) > 25:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    crop = wm.crop((max(0, min_x - 4), max(0, min_y - 4), min(w, max_x + 5), min(h, max_y + 5)))
    canvas = Image.new("RGBA", (size, size), bg)
    max_w = int(size * 0.72)
    scale = max_w / crop.size[0]
    nw, nh = max_w, max(1, int(crop.size[1] * scale))
    resized = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def save(img: Image.Image, path: Path) -> None:
    img.save(path, format="PNG", optimize=True)
    print("wrote", path.name)


def main() -> None:
    mark_path = next((p for p in MARK_CANDIDATES if p.exists()), None)
    if mark_path is None:
        raise SystemExit("No mark source found. Place nikcli-icon-mark-source.png or icon-dark.png.")

    mark_dark = trim_content(ensure_rgba(Image.open(mark_path)))
    # If source is already a full icon with padding, trim again after opening icon-dark
    if mark_path.name == "icon-dark.png":
        mark_dark = trim_content(mark_dark, pad=4)
    mark_light = recolor_mark_for_light(mark_dark)

    icon_dark = fit_on_canvas(mark_dark, 1024, (0, 0, 0, 255), 0.16)
    icon_light = fit_on_canvas(mark_light, 1024, (255, 255, 255, 255), 0.16)

    save(icon_dark, ASSETS / "icon.png")
    save(icon_dark, ASSETS / "icon-dark.png")
    save(icon_light, ASSETS / "icon-light.png")
    save(icon_dark, ASSETS / "adaptive-icon.png")
    save(icon_light, ASSETS / "adaptive-icon-light.png")
    save(fit_on_canvas(mark_dark, 128, (0, 0, 0, 255), 0.12), ASSETS / "app-icon-mark.png")
    save(fit_on_canvas(mark_light, 128, (255, 255, 255, 255), 0.12), ASSETS / "app-icon-mark-light.png")
    save(fit_on_canvas(mark_dark, 48, (0, 0, 0, 255), 0.08), ASSETS / "favicon.png")
    save(fit_on_canvas(mark_light, 48, (255, 255, 255, 255), 0.08), ASSETS / "favicon-light.png")

    splash_dark = compose_splash(ASSETS / "wordmark-dark.png", (0, 0, 0, 255))
    splash_light = compose_splash(ASSETS / "wordmark-light.png", (255, 255, 255, 255))
    save(splash_dark, ASSETS / "splash.png")
    save(splash_dark, ASSETS / "splash-dark.png")
    save(splash_light, ASSETS / "splash-light.png")

    # Keep archival master identical to the dark (pale) transparent variant.
    (ASSETS / "wordmark.png").write_bytes((ASSETS / "wordmark-dark.png").read_bytes())
    print("synced wordmark.png ← wordmark-dark.png")


if __name__ == "__main__":
    main()
