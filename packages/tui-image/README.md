# @nikcli-ai/tui-image

Terminal image rendering primitives for NikCLI and OpenTUI applications.

The package decodes images into an RGBA pixel buffer and renders them with:

- Kitty Graphics Protocol
- Kitty Unicode placeholders for grid-safe OpenTUI placement
- iTerm2 inline images
- Sixel
- Unicode half-block, Braille, and ASCII fallbacks

## Render An Image

```ts
import { renderImage } from "@nikcli-ai/tui-image"

const input = new Uint8Array(await Bun.file("logo.png").arrayBuffer())
const result = await renderImage({
  input,
  columns: 60,
  rows: 20,
})

process.stdout.write(typeof result.output === "string" ? result.output : Buffer.from(result.output))
```

`renderImage` uses conservative environment detection. OpenTUI consumers
should merge `renderer.capabilities` with `applyLiveCapabilities` before
selecting Kitty or Sixel.

## OpenTUI Placement

Cursor-addressed image protocols are not ordinary grid content. For Kitty and
Ghostty, use `encodeKittyVirtual` and render the strings from
`kittyPlaceholderGrid` as OpenTUI text cells using the foreground color from
`kittyIdColor`.

For terminals without Kitty Unicode placeholders, NikCLI can register an
iTerm2 or Sixel cursor overlay in OpenTUI's native render pass. WezTerm uses
the iTerm2 path, so images are rendered as pixels even when the shell is
PowerShell.

Terminals that expose none of these native protocols, including Windows
Terminal, use the truecolor ANSI half-block renderer inside the OpenTUI grid.
The Braille renderer remains available when higher geometric resolution is
more important than color fidelity. NikCLI's integration is in
`packages/nikcli/src/cli/cmd/tui/component/tui-image.tsx`.
