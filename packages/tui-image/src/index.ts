/**
 * @nikcli-ai/tui-image
 *
 * WASM-compatible image rendering for TUI / OpenTUI terminals. The package
 * auto-detects the best graphics protocol (Kitty, Sixel, iTerm2) and falls
 * back to Unicode half-blocks, Braille, or ASCII blocks. Image decoding is
 * pluggable: we ship Jimp (pure JS) and photon-node (WASM) decoders, but
 * any function that turns bytes into a {@link PixelImage} works.
 *
 * Quick start:
 *
 * ```ts
 * import { renderImage, Protocol } from "@nikcli-ai/tui-image"
 *
 * const bytes = await Bun.file("logo.png").bytes()
 * const { output, renderer, capabilities } = await renderImage({
 *   input: new Uint8Array(bytes),
 *   columns: 80,
 *   rows: 24,
 * })
 * process.stdout.write(typeof output === "string" ? output : new TextDecoder().decode(output))
 * ```
 *
 * The package is intentionally dependency-light at the top level: the public
 * surface is the same in Node, Bun, and the browser. The heavy machinery
 * (image decoding, PNG encoding) is pulled in lazily and only when used.
 */
export * from "./render"
export * from "./capabilities"
export * from "./encode"
export * from "./decode"
export * from "./pixels"
