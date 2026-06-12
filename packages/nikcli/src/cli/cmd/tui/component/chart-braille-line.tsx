import { TextAttributes, RGBA } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import type { Theme } from "../context/theme"

// ===== Color utilities =====

function vizRgb(r: number, g: number, b: number): RGBA {
  return RGBA.fromInts(r, g, b)
}

/**
 * Theme-aware fallback dataviz palette.
 *
 * Why this exists: the original chart palette was a set of hardcoded RGBA
 * values that ignored the active theme, so on, say, a light "github-light"
 * theme the chart would still paint bright cyan/orange that fought the
 * background. The new palette is derived from the theme's semantic tokens
 * (`primary`, `accent`, `success`, `warning`, `error`, `info`) with
 * luminance-shifted variants for the additional series, so charts stay
 * legible on any background while keeping enough hue variety to
 * distinguish multi-series line charts at a glance.
 */
function luminance(rgba: RGBA): number {
  // Standard ITU-R BT.601 weighting; used to decide if a derived color
  // needs lightening or darkening for legibility.
  return (0.299 * rgba.r + 0.587 * rgba.g + 0.114 * rgba.b) / 255
}

function shift(rgba: RGBA, dr: number, dg: number, db: number): RGBA {
  return RGBA.fromInts(
    Math.max(0, Math.min(255, Math.round(rgba.r * 255 + dr))),
    Math.max(0, Math.min(255, Math.round(rgba.g * 255 + dg))),
    Math.max(0, Math.min(255, Math.round(rgba.b * 255 + db))),
  )
}

/**
 * Derive an N-color categorical palette from a theme. The first 4 colors
 * mirror the semantic tokens (primary, success, warning, accent) so that
 * the most-used positions stay consistent with the rest of the UI; the
 * remaining slots are hue-rotated shifts of `primary` so each series
 * remains distinguishable on a chart with 5+ series.
 */
function themeSeriesPalette(theme: Theme): RGBA[] {
  // Hue rotation by mixing with rotated neighbors. Each rotation shifts
  // along the R→G→B ring so the resulting colors stay saturated.
  const primary = theme.primary
  const rotated = (base: RGBA, steps: number): RGBA => {
    // 120° hue rotation via channel swap. Three steps covers the full ring.
    let r = base.r * 255
    let g = base.g * 255
    let b = base.b * 255
    const dir = steps > 0 ? 1 : -1
    for (let i = 0; i < Math.abs(steps); i++) {
      if (dir > 0) {
        const nr = g
        const ng = b
        const nb = r
        r = nr
        g = ng
        b = nb
      } else {
        const nr = b
        const ng = r
        const nb = g
        r = nr
        g = ng
        b = nb
      }
    }
    return RGBA.fromInts(Math.round(r), Math.round(g), Math.round(b))
  }

  // For the input/output/cache/reasoning semantic colors, derive from
  // theme tokens instead of hardcoding RGB. If the theme's tokens are very
  // close to the background, push them away for chart legibility.
  const isLow = (c: RGBA) => luminance(c) < 0.15
  const lift = (c: RGBA) => (isLow(c) ? shift(c, 60, 60, 60) : c)

  return [
    lift(theme.primary), // 0 — primary
    lift(theme.success), // 1 — success/positive
    lift(theme.warning), // 2 — warning/cache
    lift(theme.accent), // 3 — accent/reasoning
    rotated(primary, 1), // 4
    rotated(primary, 2), // 5
    rotated(primary, -1), // 6
    rotated(primary, -2), // 7
  ]
}

function themeSemanticColors(theme: Theme) {
  return {
    input: theme.primary,
    output: theme.warning,
    cache: theme.success,
    cacheWrite: theme.info,
    reasoning: theme.accent,
    alert: theme.error,
  }
}

/**
 * Chart colors used by the analytics panel. Derived from the active theme
 * so charts adapt to light/dark/sepia themes; falls back to a saturated
 * palette on themes whose tokens have very low luminance.
 */
export function getChartColors(theme: Theme): {
  series: RGBA[]
  input: RGBA
  output: RGBA
  cache: RGBA
  cacheWrite: RGBA
  reasoning: RGBA
  alert: RGBA
} {
  const series = themeSeriesPalette(theme)
  const sem = themeSemanticColors(theme)
  return {
    series,
    ...sem,
  }
}

// ===== Braille Encoding =====
// Each braille character (U+2800–U+28FF) encodes a 2×4 dot matrix:
//
// Dot layout:        Bit mapping:
// col 0  col 1       Bit 0 (0x01) → row 0, col 0
// ┌────┬────┐        Bit 1 (0x02) → row 1, col 0
// │ 1  │ 8  │ row 0  Bit 2 (0x04) → row 2, col 0
// │ 2  │ 16 │ row 1  Bit 3 (0x08) → row 0, col 1
// │ 4  │ 32 │ row 2  Bit 4 (0x10) → row 1, col 1
// │ 64 │ 128│ row 3  Bit 5 (0x20) → row 2, col 1
// └────┴────┘        Bit 6 (0x40) → row 3, col 0
//                    Bit 7 (0x80) → row 3, col 1

const BRAILLE_BASE = 0x2800
const BRAILLE_BITS: number[][] = [
  [0x01, 0x08], // row 0
  [0x02, 0x10], // row 1
  [0x04, 0x20], // row 2
  [0x40, 0x80], // row 3
]

// Render data points into a braille grid
function renderBrailleGrid(data: number[], charW: number, charH: number): string[] {
  const pixelW = charW * 2
  const pixelH = charH * 4

  if (data.length === 0) {
    return Array.from({ length: charH }, () => " ".repeat(charW))
  }

  // Normalize data to pixel coordinates
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1

  // Create pixel grid using Uint8Array for bitfield
  const grid: Uint8Array[] = Array.from({ length: pixelH }, () => new Uint8Array(Math.ceil(pixelW / 8)))

  function setPixel(x: number, y: number) {
    if (x >= 0 && x < pixelW && y >= 0 && y < pixelH) {
      const byteIdx = Math.floor(x / 8)
      const bitIdx = x % 8
      grid[y]![byteIdx] |= 1 << bitIdx
    }
  }

  function isPixelSet(x: number, y: number): boolean {
    if (x < 0 || x >= pixelW || y < 0 || y >= pixelH) return false
    const byteIdx = Math.floor(x / 8)
    const bitIdx = x % 8
    return (grid[y]![byteIdx] & (1 << bitIdx)) !== 0
  }

  function drawLine(g: Uint8Array[], x0: number, y0: number, x1: number, y1: number, w: number, h: number) {
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx - dy
    let x = x0
    let y = y0
    while (true) {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        const byteIdx = Math.floor(x / 8)
        const bitIdx = x % 8
        g[y]![byteIdx] |= 1 << bitIdx
      }
      if (x === x1 && y === y1) break
      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        x += sx
      }
      if (e2 < dx) {
        err += dx
        y += sy
      }
    }
  }

  // Map data to pixel coordinates
  const points: { x: number; y: number }[] = data.map((value, i) => {
    const x = data.length === 1 ? Math.floor(pixelW / 2) : Math.round((i / (data.length - 1)) * (pixelW - 1))
    const normalized = (value - min) / range
    const y = Math.round((1 - normalized) * (pixelH - 1))
    return {
      x: Math.max(0, Math.min(pixelW - 1, x)),
      y: Math.max(0, Math.min(pixelH - 1, y)),
    }
  })

  // Draw lines between consecutive points using Bresenham
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!
    const p2 = points[i + 1]!
    drawLine(grid, p1.x, p1.y, p2.x, p2.y, pixelW, pixelH)
  }

  // Draw dots at data points
  for (const p of points) {
    setPixel(p.x, p.y)
    // Also set adjacent pixels for thicker dots
    if (p.x + 1 < pixelW) setPixel(p.x + 1, p.y)
    if (p.y + 1 < pixelH) setPixel(p.x, p.y + 1)
  }

  // Convert pixel grid to braille characters
  const lines: string[] = []
  for (let cy = 0; cy < charH; cy++) {
    let line = ""
    for (let cx = 0; cx < charW; cx++) {
      let mask = 0
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 2; px++) {
          const pixelX = cx * 2 + px
          const pixelY = cy * 4 + py
          if (isPixelSet(pixelX, pixelY)) {
            mask |= BRAILLE_BITS[py]![px]!
          }
        }
      }
      line += String.fromCharCode(BRAILLE_BASE + mask)
    }
    lines.push(line)
  }
  return lines
}

// Multi-series rendering: OR braille masks from multiple series
function renderMultiSeriesBraille(
  seriesData: number[][],
  charW: number,
  charH: number,
): { lines: string[]; seriesMask: number[][][] } {
  const pixelW = charW * 2
  const pixelH = charH * 4

  // Find global min/max across all series
  let globalMax = 1
  let globalMin = 0
  for (const data of seriesData) {
    for (const v of data) {
      globalMax = Math.max(globalMax, v)
      globalMin = Math.min(globalMin, v)
    }
  }
  const range = globalMax - globalMin || 1

  // Create pixel grid per series
  const seriesGrids: boolean[][][] = seriesData.map(() =>
    Array.from({ length: pixelH }, () => new Array(pixelW).fill(false)),
  )

  for (let s = 0; s < seriesData.length; s++) {
    const data = seriesData[s]!
    const grid = seriesGrids[s]!

    if (data.length === 0) continue

    const points: { x: number; y: number }[] = data.map((value, i) => {
      const x = data.length === 1 ? Math.floor(pixelW / 2) : Math.round((i / (data.length - 1)) * (pixelW - 1))
      const normalized = (value - globalMin) / range
      const y = Math.round((1 - normalized) * (pixelH - 1))
      return {
        x: Math.max(0, Math.min(pixelW - 1, x)),
        y: Math.max(0, Math.min(pixelH - 1, y)),
      }
    })

    // Bresenham for this series
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]!
      const p2 = points[i + 1]!
      const dx = Math.abs(p2.x - p1.x)
      const dy = Math.abs(p2.y - p1.y)
      const sx = p1.x < p2.x ? 1 : -1
      const sy = p1.y < p2.y ? 1 : -1
      let err = dx - dy
      let x = p1.x
      let y = p1.y
      while (true) {
        if (x >= 0 && x < pixelW && y >= 0 && y < pixelH) grid[y]![x] = true
        if (x === p2.x && y === p2.y) break
        const e2 = 2 * err
        if (e2 > -dy) {
          err -= dy
          x += sx
        }
        if (e2 < dx) {
          err += dx
          y += sy
        }
      }
    }

    // Dots at data points
    for (const p of points) {
      if (p.x >= 0 && p.x < pixelW && p.y >= 0 && p.y < pixelH) grid[p.y]![p.x] = true
    }
  }

  // Determine dominant series per character cell
  const seriesMask: number[][][] = Array.from({ length: charH }, () =>
    Array.from({ length: charW }, () => [] as number[]),
  )

  // Build combined braille lines
  const lines: string[] = []
  for (let cy = 0; cy < charH; cy++) {
    let line = ""
    for (let cx = 0; cx < charW; cx++) {
      let mask = 0
      const contributing: number[] = []
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 2; px++) {
          const pixelX = cx * 2 + px
          const pixelY = cy * 4 + py
          if (pixelY < pixelH && pixelX < pixelW) {
            // Check all series for this pixel (last series wins for color)
            for (let s = seriesData.length - 1; s >= 0; s--) {
              if (seriesGrids[s]![pixelY]![pixelX]) {
                mask |= BRAILLE_BITS[py]![px]!
                if (!contributing.includes(s)) contributing.push(s)
                break
              }
            }
          }
        }
      }
      seriesMask[cy]![cx] = contributing
      line += String.fromCharCode(BRAILLE_BASE + mask)
    }
    lines.push(line)
  }

  return { lines, seriesMask }
}

// ===== Format helpers =====

function formatTokens(n: number): string {
  if (n < 1_000) return n.toString()
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// ===== COMPONENTS =====

/**
 * Multi-series line chart with per-character color segmentation.
 *
 * Earlier revisions colored each row by its dominant series — meaning a
 * 3-series chart looked like a single line in one color, defeating the
 * purpose of having multiple series. This version splits each row into
 * runs of characters that share the same dominant series and emits one
 * <text> per run with the matching color, so crossovers between two
 * series render in their own distinct hues.
 *
 * Concretely: the 30-day token-usage chart with Input (primary),
 * Output (warning) and Cache (success) now shows a primary-blue bulk
 * with orange and green segments where Output or Cache cross above
 * Input — making trends per category visible at a glance.
 */
export function BrailleLineChart(props: {
  series: { label: string; data: number[]; color: RGBA }[]
  width: number
  height: number
  yFormat?: (v: number) => string
  showGrid?: boolean
  showLegend?: boolean
  showAxis?: boolean
}) {
  const { theme } = useTheme()

  const yFmt = () => props.yFormat ?? formatTokens

  const chart = createMemo(() => {
    const series = props.series
    if (series.length === 0 || series.every((s) => s.data.length === 0)) {
      return {
        lines: [],
        xLabels: [],
        yLabels: [],
        legend: [],
        rowSegments: [] as Array<Array<{ text: string; color: RGBA }>>,
      }
    }

    const chartW = props.width - (props.showAxis !== false ? 7 : 0)
    const chartH = props.height

    if (chartW <= 0 || chartH <= 0) {
      return {
        lines: [],
        xLabels: [],
        yLabels: [],
        legend: [],
        rowSegments: [] as Array<Array<{ text: string; color: RGBA }>>,
      }
    }

    // Render multi-series braille
    const seriesData = series.map((s) => s.data)
    const { lines, seriesMask } = renderMultiSeriesBraille(seriesData, chartW, chartH)

    // Find global max for Y-axis labels
    let globalMax = 1
    for (const s of series) {
      for (const v of s.data) {
        globalMax = Math.max(globalMax, v)
      }
    }

    // Y-axis labels
    const yLabels: { pos: number; label: string }[] = []
    const numLabels = Math.min(3, chartH)
    for (let i = 0; i < numLabels; i++) {
      const value = (globalMax * (numLabels - 1 - i)) / (numLabels - 1)
      const y = Math.round((i / (numLabels - 1)) * (chartH - 1))
      yLabels.push({ pos: y, label: yFmt()(value) })
    }

    // X-axis labels (first, middle, last)
    const firstSeries = series.find((s) => s.data.length > 0)
    const xLabels: { pos: number; label: string }[] = []
    if (firstSeries && firstSeries.data.length >= 1) {
      xLabels.push({ pos: 0, label: "0" })
    }
    if (firstSeries && firstSeries.data.length >= 3) {
      xLabels.push({
        pos: Math.floor(chartW / 2),
        label: Math.floor(firstSeries.data.length / 2).toString(),
      })
    }
    if (firstSeries && firstSeries.data.length >= 2) {
      xLabels.push({
        pos: chartW - 1,
        label: (firstSeries.data.length - 1).toString(),
      })
    }

    // Per-row color segmentation: walk each row left-to-right, accumulate
    // runs of characters with the same dominant series, and emit one
    // segment per run. Empty cells (no series) are rendered in
    // `textMuted` so the grid keeps its background tone.
    const rowSegments: Array<Array<{ text: string; color: RGBA }>> = []
    for (let cy = 0; cy < lines.length; cy++) {
      const row = lines[cy]!
      const rowMask = seriesMask[cy] ?? []
      const segments: Array<{ text: string; color: RGBA }> = []
      let runText = ""
      let runColor: RGBA | null = null
      const flush = () => {
        if (runText) {
          segments.push({ text: runText, color: runColor ?? theme.text })
        }
        runText = ""
        runColor = null
      }
      for (let cx = 0; cx < row.length; cx++) {
        const contributing = rowMask[cx] ?? []
        let color: RGBA
        if (contributing.length === 0) {
          color = theme.textMuted
        } else {
          // Pick the highest-indexed contributing series (matches the
          // pixel-order used during render so segment colors line up
          // with which line is "on top" at that character).
          const idx = contributing[contributing.length - 1]!
          color = series[idx]?.color ?? theme.text
        }
        if (runColor && colorsEqual(runColor, color)) {
          runText += row[cx]
        } else {
          flush()
          runText = row[cx] ?? ""
          runColor = color
        }
      }
      flush()
      rowSegments.push(segments)
    }

    return {
      lines,
      xLabels,
      yLabels,
      seriesMask,
      rowSegments,
      legend: series.map((s) => ({ label: s.label, color: s.color })),
    }
  })

  return (
    <box gap={0}>
      {/* Legend */}
      <Show when={props.showLegend !== false && chart().legend.length > 0}>
        <box flexDirection="row" gap={3} paddingBottom={1}>
          <For each={chart().legend}>
            {(item) => (
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={item.color} wrapMode="none">
                  ■
                </text>
                <text fg={theme.textMuted}>{item.label}</text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <box flexDirection="row" gap={0}>
        {/* Y-axis labels */}
        <Show when={props.showAxis !== false}>
          <box flexDirection="column" gap={0}>
            <For each={chart().yLabels}>
              {(yl) => (
                <text fg={theme.textMuted} width={6} wrapMode="none">
                  {yl.label.padStart(6)}
                </text>
              )}
            </For>
          </box>
          {/* Axis line */}
          <text fg={theme.border} wrapMode="none">
            {"│".repeat(1)}
          </text>
        </Show>

        {/* Chart area: one box per row, with per-color text segments inside */}
        <box flexDirection="column" gap={0}>
          <For each={chart().rowSegments}>
            {(segments) => (
              <box flexDirection="row" gap={0}>
                <For each={segments}>
                  {(seg) => (
                    <text fg={seg.color} wrapMode="none">
                      {seg.text}
                    </text>
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      </box>
    </box>
  )
}

/**
 * Compare two RGBA values for equality. RGBA from @opentui/core uses r/g/b
 * as 0..1 floats; for chart-segmentation purposes exact equality is
 * sufficient because we never mutate the color mid-segment.
 */
function colorsEqual(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && (a.a ?? 1) === (b.a ?? 1)
}

// Braille Area Chart - filled area below the line
export function BrailleAreaChart(props: {
  data: number[]
  width: number
  height: number
  color: RGBA
  yFormat?: (v: number) => string
}) {
  const lines = createMemo(() => {
    if (props.data.length === 0) return []

    const pixelW = props.width * 2
    const pixelH = props.height * 4

    const max = Math.max(...props.data, 1)
    const min = Math.min(...props.data, 0)
    const range = max - min || 1

    // Create pixel grid
    const grid: boolean[][] = Array.from({ length: pixelH }, () => new Array(pixelW).fill(false))

    // Map data to pixel coords and draw filled area
    const points: { x: number; y: number }[] = props.data.map((value, i) => {
      const x =
        props.data.length === 1 ? Math.floor(pixelW / 2) : Math.round((i / (props.data.length - 1)) * (pixelW - 1))
      const normalized = (value - min) / range
      const y = Math.round((1 - normalized) * (pixelH - 1))
      return {
        x: Math.max(0, Math.min(pixelW - 1, x)),
        y: Math.max(0, Math.min(pixelH - 1, y)),
      }
    })

    // Fill area below each point
    for (const p of points) {
      for (let y = p.y; y < pixelH; y++) {
        grid[y]![p.x] = true
      }
    }

    // Draw line on top
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]!
      const p2 = points[i + 1]!
      const dx = Math.abs(p2.x - p1.x)
      const dy = Math.abs(p2.y - p1.y)
      const sx = p1.x < p2.x ? 1 : -1
      const sy = p1.y < p2.y ? 1 : -1
      let err = dx - dy
      let x = p1.x
      let y = p1.y
      while (true) {
        if (x >= 0 && x < pixelW && y >= 0 && y < pixelH) grid[y]![x] = true
        if (x === p2.x && y === p2.y) break
        const e2 = 2 * err
        if (e2 > -dy) {
          err -= dy
          x += sx
        }
        if (e2 < dx) {
          err += dx
          y += sy
        }
      }
    }

    // Convert to braille
    const result: string[] = []
    for (let cy = 0; cy < props.height; cy++) {
      let line = ""
      for (let cx = 0; cx < props.width; cx++) {
        let mask = 0
        for (let py = 0; py < 4; py++) {
          for (let px = 0; px < 2; px++) {
            const pixelX = cx * 2 + px
            const pixelY = cy * 4 + py
            if (pixelY < pixelH && pixelX < pixelW && grid[pixelY]![pixelX]) {
              mask |= BRAILLE_BITS[py]![px]!
            }
          }
        }
        line += String.fromCharCode(BRAILLE_BASE + mask)
      }
      result.push(line)
    }
    return result
  })

  return (
    <box flexDirection="column" gap={0}>
      <For each={lines()}>
        {(line) => (
          <text fg={props.color} wrapMode="none">
            {line}
          </text>
        )}
      </For>
    </box>
  )
}

// Braille Sparkline - compact inline chart using braille
export function BrailleSparkline(props: { data: number[]; width: number; color: RGBA }) {
  const lines = createMemo(() => {
    if (props.data.length === 0) return [" ".repeat(props.width)]

    const chartH = 2 // 2 rows of braille = 8 pixel rows
    return renderBrailleGrid(props.data, props.width, chartH)
  })

  return (
    <box flexDirection="column" gap={0}>
      <For each={lines()}>
        {(line) => (
          <text fg={props.color} wrapMode="none">
            {line}
          </text>
        )}
      </For>
    </box>
  )
}

// Stacked Bar Chart with 8-level Unicode blocks
export function StackedBarChartV2(props: {
  segments: { label: string; value: number; color: RGBA }[]
  width: number
  showLabels?: boolean
}) {
  const { theme } = useTheme()
  const total = createMemo(() => props.segments.reduce((sum, s) => sum + s.value, 0))
  const bars = createMemo(() => {
    const t = total()
    if (t === 0)
      return props.segments.map((s) => ({
        ...s,
        width: Math.floor(props.width / props.segments.length),
      }))

    let remaining = props.width
    return props.segments.map((s, i) => {
      const w =
        i === props.segments.length - 1 ? Math.max(0, remaining) : Math.max(1, Math.floor((s.value / t) * props.width))
      remaining -= w
      return { ...s, width: w }
    })
  })

  return (
    <box flexDirection="column" gap={0}>
      {/* Bar */}
      <box flexDirection="row" gap={0}>
        <For each={bars()}>
          {(seg) => (
            <text fg={seg.color} wrapMode="none">
              {"█".repeat(seg.width)}
            </text>
          )}
        </For>
      </box>
      <Show when={props.showLabels}>
        <box flexDirection="row" gap={2}>
          <For each={props.segments}>
            {(seg) => (
              <box flexDirection="row" gap={1} alignItems="center">
                <text fg={seg.color} wrapMode="none">
                  ■
                </text>
                <text fg={theme.textMuted}>
                  {seg.label} ({formatTokens(seg.value)})
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

// Horizontal bar with 8-level precision (▏▎▍▌▋▊▉█)
export function HBarPrecision(props: {
  label: string
  value: number
  max: number
  width: number
  color: RGBA
  showPct?: boolean
}) {
  const { theme } = useTheme()
  const filled = createMemo(() => {
    if (props.max <= 0 || !Number.isFinite(props.max)) return 0
    return Math.min(props.width, Math.max(0, (props.value / props.max) * props.width))
  })
  const fullBlocks = createMemo(() => Math.floor(filled()))
  const partial = createMemo(() => {
    const frac = filled() - fullBlocks()
    const chars = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▇"]
    const idx = Math.round(frac * 8)
    return chars[Math.min(idx, 7)] ?? ""
  })
  const pct = createMemo(() => Math.round((props.value / props.max) * 100))

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text fg={theme.textMuted} width={10} wrapMode="none">
        {props.label.padEnd(10)}
      </text>
      <text fg={props.color} wrapMode="none">
        {"█".repeat(fullBlocks())}
        {partial()}
      </text>
      <text fg={theme.borderSubtle} wrapMode="none">
        {"░".repeat(Math.max(0, props.width - fullBlocks() - (partial() ? 1 : 0)))}
      </text>
      <text fg={theme.textMuted}>{formatTokens(props.value)}</text>
      <Show when={props.showPct}>
        <text fg={props.color}>({pct()}%)</text>
      </Show>
    </box>
  )
}

// KPI Card with box-drawing border, optional sparkline + delta indicator.
//
// The card is laid out as a 2×2 grid:
//   ┌─────────────┐
//   │ LABEL       │ ← muted, top
//   │ VALUE       │ ← bold, theme color
//   │ SUBTITLE    │ ← muted
//   │ ▁▂▃▅▆▇ +12% │ ← sparkline + delta (when provided)
//   └────────────┘
//
// The sparkline fills the full card width and is rendered with 2 rows of
// braille (8 pixel rows), giving readable trend shapes in a compact space.
// The delta indicator uses `theme.success` for "good" and `theme.error` for
// "bad"; pass `deltaInverse` to flip the polarity (e.g. cost, error rate).
export function KPICard(props: {
  label: string
  value: string
  color: RGBA
  subtitle?: string
  sparkline?: number[]
  /** Pct change vs the comparable preceding period. ±Infinity = "new" baseline. */
  delta?: { pct: number; inverse?: boolean }
  /** When true, the card uses `borderActive` instead of `border` (e.g. on hover). */
  active?: boolean
}) {
  const { theme } = useTheme()

  const deltaInfo = createMemo(() => {
    const d = props.delta
    if (!d) return undefined
    if (!Number.isFinite(d.pct)) {
      if (d.pct === 0) return undefined
      const good = d.pct > 0 ? !d.inverse : d.inverse
      return { text: d.pct > 0 ? "new" : "−new", good }
    }
    if (d.pct === 0) return { text: "—", good: null as boolean | null }
    const arrow = d.pct > 0 ? "↑" : "↓"
    const text = `${arrow} ${Math.abs(d.pct).toFixed(1)}%`
    const good = d.pct > 0 ? !d.inverse : d.inverse
    return { text, good: good as boolean | null }
  })

  const deltaColor = createMemo<RGBA>(() => {
    const info = deltaInfo()
    if (!info || info.good === null) return theme.textMuted
    return info.good ? theme.success : theme.error
  })

  return (
    <box flexDirection="column" gap={0} border borderColor={props.active ? theme.borderActive : theme.border}>
      <text fg={theme.textMuted} paddingLeft={1} paddingRight={1} wrapMode="none">
        {props.label}
      </text>
      <text fg={props.color} attributes={TextAttributes.BOLD} paddingLeft={1} paddingRight={1} wrapMode="none">
        {props.value}
      </text>
      <Show when={props.subtitle}>
        <text fg={theme.textMuted} paddingLeft={1} paddingRight={1} wrapMode="none">
          {props.subtitle}
        </text>
      </Show>
      <Show when={props.sparkline && props.sparkline.length > 0}>
        <box paddingLeft={1} paddingRight={1}>
          <BrailleSparkline
            data={props.sparkline!}
            width={Math.max(6, (props.value?.length ?? 4) + 4)}
            color={props.color}
          />
        </box>
      </Show>
      <Show when={deltaInfo()}>
        <text fg={deltaColor()} paddingLeft={1} paddingRight={1} wrapMode="none">
          {deltaInfo()!.text}
        </text>
      </Show>
    </box>
  )
}

// Model Card with bar charts
export function ModelCard(props: {
  name: string
  provider: string
  requests: number
  avgResponseTime?: number
  inputTokens: number
  outputTokens: number
  maxTokens: number
  color: RGBA
}) {
  const { theme } = useTheme()
  const viz = createMemo(() => getChartColors(theme))
  const barWidth = 20

  const inputBar = createMemo(() => {
    const filled = Math.round((props.inputTokens / props.maxTokens) * barWidth)
    return "█".repeat(Math.max(0, Math.min(barWidth, filled)))
  })
  const outputBar = createMemo(() => {
    const filled = Math.round((props.outputTokens / props.maxTokens) * barWidth)
    return "█".repeat(Math.max(0, Math.min(barWidth, filled)))
  })

  return (
    <box flexDirection="column" gap={0} border borderColor={theme.borderSubtle} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.name}
        </text>
        <text fg={theme.textMuted}>{props.provider}</text>
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted}>Requests:</text>
        <text fg={theme.text}>{props.requests}</text>
        <Show when={props.avgResponseTime != null}>
          <text fg={theme.textMuted}>Avg:</text>
          <text fg={theme.text}>{props.avgResponseTime}ms</text>
        </Show>
      </box>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.textMuted} width={7} wrapMode="none">
          {"Input: "}
        </text>
        <text fg={viz().input} wrapMode="none">
          {inputBar()}
        </text>
        <text fg={theme.textMuted}>{formatTokens(props.inputTokens)}</text>
      </box>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.textMuted} width={7} wrapMode="none">
          {"Output:"}
        </text>
        <text fg={viz().output} wrapMode="none">
          {outputBar()}
        </text>
        <text fg={theme.textMuted}>{formatTokens(props.outputTokens)}</text>
      </box>
    </box>
  )
}

/**
 * Compact horizontal bar list for ranked data.
 *
 * Each row shows: `name │ ████░░ │ value` with sub-cell precision (▏▎▍▌▋▊▉).
 * `name` is truncated to `nameWidth` characters with a trailing ellipsis
 * when needed, and the bar length is computed from `value / maxValue * barWidth`.
 *
 * Used for "Top Tools", "Top Agents" and any other ranked-list view in the
 * analytics panel. Replaces the previous tools-tab implementation that
 * used a `█`.repeat(barWidth) bar with no fractional precision and a 1/20
 * step granularity.
 */
export function RankedBarList(props: {
  items: { name: string; value: number; subValue?: string; color?: RGBA }[]
  maxValue?: number
  nameWidth?: number
  barWidth?: number
  /** When set, bars for the first `highlight` items are rendered in the
   *  provided color; the rest use `theme.textMuted`. */
  highlight?: number
  /** When set, the value column is formatted with this function. */
  formatValue?: (v: number) => string
}) {
  const { theme } = useTheme()
  const nameWidth = () => props.nameWidth ?? 18
  const barWidth = () => props.barWidth ?? 18
  const max = createMemo(() => {
    if (props.maxValue !== undefined) return Math.max(1, props.maxValue)
    let m = 1
    for (const it of props.items) if (it.value > m) m = it.value
    return m
  })
  const fmt = () => props.formatValue ?? formatTokens

  return (
    <box flexDirection="column" gap={0}>
      <For each={props.items}>
        {(item, idx) => {
          const isHi = () => props.highlight === undefined || idx() < props.highlight!
          const color = (): RGBA => {
            if (item.color) return item.color
            return isHi() ? theme.primary : theme.textMuted
          }
          // 1/8 precision per cell — same encoding as HBarPrecision
          const filled = () => Math.min(barWidth(), Math.max(0, (item.value / max()) * barWidth()))
          const full = () => Math.floor(filled())
          const frac = () => {
            const f = filled() - full()
            const chars = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▇"]
            const i = Math.round(f * 8)
            return chars[Math.min(i, 7)] ?? ""
          }
          const displayName = () => {
            const n = item.name
            if (n.length <= nameWidth()) return n.padEnd(nameWidth())
            return n.slice(0, nameWidth() - 1) + "…"
          }
          return (
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.text} width={nameWidth()} wrapMode="none">
                {displayName()}
              </text>
              <text fg={color()} wrapMode="none">
                {"█".repeat(full())}
                {frac()}
              </text>
              <text fg={theme.borderSubtle} wrapMode="none">
                {"░".repeat(Math.max(0, barWidth() - full() - (frac() ? 1 : 0)))}
              </text>
              <text fg={theme.textMuted} wrapMode="none">
                {fmt()(item.value)}
                {item.subValue ? ` ${item.subValue}` : ""}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}
