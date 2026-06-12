import { createMemo } from "solid-js"
import type { RGBA } from "@opentui/core"
import { theme } from "../theme"

interface SparklineProps {
  values: number[]
  width?: number
  fg?: RGBA
  showLabels?: boolean
  min?: number
  max?: number
}

export function Sparkline(props: SparklineProps) {
  const chars = createMemo(() => {
    const vals = props.values
    if (vals.length < 2) return ""
    const min = props.min ?? Math.min(...vals)
    const max = props.max ?? Math.max(...vals)
    const range = max - min || 1
    const blocks = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"]
    const w = props.width ?? Math.min(vals.length, 20)
    const step = Math.max(1, Math.floor(vals.length / w))
    const sampled = vals.filter((_, i) => i % step === 0).slice(0, w)
    return sampled.map((v) => blocks[Math.round(((v - min) / range) * 7)]).join("")
  })

  return <text fg={props.fg ?? theme.cyan} content={chars()} wrapMode="none" />
}
