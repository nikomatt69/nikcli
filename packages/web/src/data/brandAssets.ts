/**
 * Single source of truth for the brand-asset download list.
 *
 * Re-used by:
 *   - /docs/brand    (docs page; long-form documentation)
 *   - /download      (downloads page; bottom section appended near footer)
 *
 * Filenames in `src` must match the PNGs in `packages/mobile/assets/`.
 * The build script `packages/web/script/build-brandkit.ts` packages them
 * into `/brand/brandkit.zip`. After updating this list, also re-run the
 * script so the zip stays in sync.
 */

export interface BrandAssetItem {
  /** Public URL served by the docs origin at native resolution */
  src: string
  /** Filename as it appears in the zip and on disk */
  name: string
  /** Pixel dimensions for the docs UI, e.g. "1024×1024" */
  dims: string
  /** Short variant label, e.g. "Dark", "Light", "Master" */
  variant: string
  /** Plain-text description used as tooltip / list subtitle */
  desc: string
}

export interface BrandAssetGroup {
  /** Stable id used as anchor target on the docs page */
  id: string
  /** Heading shown on the docs page */
  title: string
  /** Short blurb shown under the heading */
  blurb: string
  /** Items in this group */
  items: BrandAssetItem[]
}

export const brandAssets: BrandAssetGroup[] = [
  {
    id: "wordmarks",
    title: "Wordmarks",
    blurb:
      "Pixel-perfect wordmark rasterizations. Transparent background, 632×206 native, ≈3.07:1 aspect.",
    items: [
      {
        src: "/brand/wordmark-dark.png",
        name: "wordmark-dark.png",
        dims: "632×206",
        variant: "Dark surface",
        desc: "Pale grey letters for dark / photographic backgrounds.",
      },
      {
        src: "/brand/wordmark-light.png",
        name: "wordmark-light.png",
        dims: "632×206",
        variant: "Light surface",
        desc: "Ink grey letters for light / paper backgrounds.",
      },
      {
        src: "/brand/wordmark.png",
        name: "wordmark.png",
        dims: "632×206",
        variant: "Master",
        desc: "Identical to wordmark-dark.png. Kept for archival and export pipelines.",
      },
    ],
  },
  {
    id: "app-icons",
    title: "App icons",
    blurb:
      "1024×1024 rasterized icons for iOS, macOS, and desktop-shell surfaces. RGBA.",
    items: [
      {
        src: "/brand/icon.png",
        name: "icon.png",
        dims: "1024×1024",
        variant: "Default",
        desc: "Dark-surface adaptive base. Identical content to icon-dark.png.",
      },
      {
        src: "/brand/icon-dark.png",
        name: "icon-dark.png",
        dims: "1024×1024",
        variant: "Dark",
        desc: "Explicit dark-mode pairing (same raster as icon.png).",
      },
      {
        src: "/brand/icon-light.png",
        name: "icon-light.png",
        dims: "1024×1024",
        variant: "Light",
        desc: "Light-surface icon for paper-like backgrounds.",
      },
    ],
  },
  {
    id: "adaptive-icons",
    title: "Adaptive icons",
    blurb:
      "Android-adaptive rasterizations (1024×1024) with a 33% safe-zone inset for OS-driven masking.",
    items: [
      {
        src: "/brand/adaptive-icon.png",
        name: "adaptive-icon.png",
        dims: "1024×1024",
        variant: "Default",
        desc: "Dark surface adaptive layer. Identical to icon.png.",
      },
      {
        src: "/brand/adaptive-icon-light.png",
        name: "adaptive-icon-light.png",
        dims: "1024×1024",
        variant: "Light",
        desc: "Light-surface adaptive layer. Identical to icon-light.png.",
      },
    ],
  },
  {
    id: "icon-marks",
    title: "Icon marks",
    blurb:
      "128×128 monogram glyphs (the «n» mark) for tight spaces where the full wordmark is too wide.",
    items: [
      {
        src: "/brand/app-icon-mark.png",
        name: "app-icon-mark.png",
        dims: "128×128",
        variant: "Default",
        desc: "Dark surface monogram for tab bars, sidebar, dock.",
      },
      {
        src: "/brand/app-icon-mark-light.png",
        name: "app-icon-mark-light.png",
        dims: "128×128",
        variant: "Light",
        desc: "Light-surface monogram for paper-like chrome.",
      },
    ],
  },
  {
    id: "favicons",
    title: "Favicons",
    blurb:
      "48×48 rasterized favicons used by <link rel=\"icon\"> declarations.",
    items: [
      {
        src: "/brand/favicon.png",
        name: "favicon.png",
        dims: "48×48",
        variant: "Default",
        desc: "Dark surface favicon for <link rel=\"icon\">.",
      },
      {
        src: "/brand/favicon-light.png",
        name: "favicon-light.png",
        dims: "48×48",
        variant: "Light",
        desc: "Light-surface favicon for paper-like browser chrome.",
      },
    ],
  },
  {
    id: "splashes",
    title: "Splash screens",
    blurb:
      "1024×1024 launch screens for the iOS, macOS and desktop shell. Square; OS handles scaling.",
    items: [
      {
        src: "/brand/splash.png",
        name: "splash.png",
        dims: "1024×1024",
        variant: "Default",
        desc: "Dark surface launch screen. Identical to splash-dark.png.",
      },
      {
        src: "/brand/splash-dark.png",
        name: "splash-dark.png",
        dims: "1024×1024",
        variant: "Dark",
        desc: "Explicit dark-mode launch screen.",
      },
      {
        src: "/brand/splash-light.png",
        name: "splash-light.png",
        dims: "1024×1024",
        variant: "Light",
        desc: "Light surface launch screen for paper-like backgrounds.",
      },
    ],
  },
]
