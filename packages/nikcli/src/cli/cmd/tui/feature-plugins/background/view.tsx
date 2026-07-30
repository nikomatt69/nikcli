/**
 * The background image itself, mounted in the `app` slot so it sits behind
 * every route: `zIndex: -1` makes the root box paint it before its siblings,
 * and text draws over it with alpha blending.
 */
import { createEffect, createMemo, createResource, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { useKV } from "@tui/context/kv"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { compose, type Rgb } from "./pixels"
import { BackgroundRenderable } from "./renderable"
import { loadImage, resolveSource } from "./source"
import { readSettings, rotation } from "./store"
import { dbg } from "./__debug"

function toRgb(color: RGBA): Rgb {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
  }
}

export function BackgroundImage() {
  dbg("BackgroundImage mounted")
  const { theme } = useTheme()
  const kv = useKV()
  const route = useRoute()
  const toast = useToast()
  const dimensions = useTerminalDimensions()

  const settings = createMemo(() => readSettings(kv))
  const visible = createMemo(() => {
    const current = settings()
    if (!current.enabled || !current.source) return false
    return current.scope === "all" || route.data.type === "home"
  })

  const [image] = createResource(
    () => (visible() ? { source: settings().source, nonce: rotation.current } : undefined),
    async (input) => loadImage(await resolveSource(input.source, input.nonce)),
  )

  // One toast per failing source, not one per re-render.
  let reported: string | undefined
  createEffect(() => {
    const error = image.error as Error | undefined
    if (!error) return
    const key = `${settings().source}:${error.message}`
    if (reported === key) return
    reported = key
    toast.show({ message: `Background image: ${error.message}`, variant: "error" })
  })

  const pixels = createMemo(() => {
    dbg(
      "pixels memo",
      JSON.stringify({
        visible: visible(),
        settings: settings(),
        dims: dimensions(),
        loading: image.loading,
        error: String(image.error ?? ""),
      }),
    )
    // Reading a failed resource re-throws, and nothing above us catches it: a
    // missing or undecodable image would kill the whole TUI. The toast above
    // already reported it, so paint no background instead.
    if (image.error) return undefined
    const source = image()
    const size = dimensions()
    if (!source || !visible() || size.width <= 0 || size.height <= 0) return undefined
    const current = settings()
    return compose(source, {
      columns: size.width,
      rows: size.height,
      fit: current.fit,
      opacity: current.opacity,
      grayscale: current.grayscale,
      base: toRgb(theme.background),
    })
  })

  return (
    <Show when={pixels()}>
      {(data) => (
        <nikcli_background
          position="absolute"
          left={0}
          top={0}
          zIndex={-1}
          width={dimensions().width}
          height={dimensions().height}
          pixels={data()}
          base={theme.background}
        />
      )}
    </Show>
  )
}

// Keeps the renderable registration in the module graph even if a bundler
// decides the class itself is otherwise unused.
export { BackgroundRenderable }
