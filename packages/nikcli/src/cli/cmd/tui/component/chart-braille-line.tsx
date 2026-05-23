import { TextAttributes, RGBA } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import type { Theme } from "../context/theme"

// ===== Color utilities =====

function vizRgb(r: number, g: number, b: number): RGBA {
  return RGBA.fromInts(r, g, b)
}

// Fixed dataviz RGBA (OpenTUI / theme convention) — legible on any theme.
const ANALYTICS_VIZ = {
  input: vizRgb(56, 189, 248),
  output: vizRgb(251, 146, 60),
  cache: vizRgb(74, 222, 128),
  reasoning: vizRgb(167, 139, 250),
  cacheWrite: vizRgb(45, 212, 191),
  alert: vizRgb(248, 113, 113),
  series: [
    vizRgb(56, 189, 248),
    vizRgb(74, 222, 128),
    vizRgb(251, 146, 60),
    vizRgb(167, 139, 250),
    vizRgb(244, 114, 182),
    vizRgb(45, 212, 191),
    vizRgb(251, 191, 36),
    vizRgb(96, 165, 250),
  ],
} as const

/** Distinct colors for analytics charts (intentionally not derived from theme accents). */
export function getChartColors(_theme: Theme): {
  series: RGBA[]
  input: RGBA
  output: RGBA
  cache: RGBA
  cacheWrite: RGBA
  reasoning: RGBA
  alert: RGBA
} {
  return {
    series: [...ANALYTICS_VIZ.series],
    input: ANALYTICS_VIZ.input,
    output: ANALYTICS_VIZ.output,
    cache: ANALYTICS_VIZ.cache,
    cacheWrite: ANALYTICS_VIZ.cacheWrite,
    reasoning: ANALYTICS_VIZ.reasoning,
    alert: ANALYTICS_VIZ.alert,
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
    return { x: Math.max(0, Math.min(pixelW - 1, x)), y: Math.max(0, Math.min(pixelH - 1, y)) }
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
      return { x: Math.max(0, Math.min(pixelW - 1, x)), y: Math.max(0, Math.min(pixelH - 1, y)) }
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

// Braille Line Chart - High resolution terminal chart
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
      return { lines: [], xLabels: [], yLabels: [], legend: [] }
    }

    const chartW = props.width - (props.showAxis !== false ? 7 : 0)
    const chartH = props.height

    if (chartW <= 0 || chartH <= 0) {
      return { lines: [], xLabels: [], yLabels: [], legend: [] }
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
      xLabels.push({ pos: Math.floor(chartW / 2), label: Math.floor(firstSeries.data.length / 2).toString() })
    }
    if (firstSeries && firstSeries.data.length >= 2) {
      xLabels.push({ pos: chartW - 1, label: (firstSeries.data.length - 1).toString() })
    }

    return { lines, xLabels, yLabels, seriesMask, legend: series.map((s) => ({ label: s.label, color: s.color })) }
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

        {/* Chart area */}
        <box flexDirection="column" gap={0}>
          <For each={chart().lines}>
            {(line, rowIdx) => {
              // Determine color for this row based on dominant series
              const rowMask = chart().seriesMask?.[rowIdx()] ?? []
              const dominantSeries = createMemo(() => {
                const counts = new Map<number, number>()
                for (const cell of rowMask) {
                  for (const s of cell) {
                    counts.set(s, (counts.get(s) ?? 0) + 1)
                  }
                }
                let best = 0
                let bestCount = 0
                for (const [s, c] of counts) {
                  if (c > bestCount) {
                    best = s
                    bestCount = c
                  }
                }
                return best
              })
              const color = createMemo(() => {
                const s = props.series[dominantSeries()]
                return s ? s.color : theme.text
              })
              return (
                <text fg={color()} wrapMode="none">
                  {line}
                </text>
              )
            }}
          </For>
        </box>
      </box>
    </box>
  )
}

// Braille Area Chart - filled area below the line
export function BrailleAreaChart(props: {
  data: number[]
  width: number
  height: number
  color: RGBA
  yFormat?: (v: number) => string
}) {
  const { theme } = useTheme()

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
      return { x: Math.max(0, Math.min(pixelW - 1, x)), y: Math.max(0, Math.min(pixelH - 1, y)) }
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
  const { theme } = useTheme()

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
    if (t === 0) return props.segments.map((s) => ({ ...s, width: Math.floor(props.width / props.segments.length) }))

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

// KPI Card with box-drawing border
export function KPICard(props: { label: string; value: string; color: RGBA; subtitle?: string }) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={0} border borderColor={theme.border}>
      <text fg={theme.textMuted} paddingLeft={1} paddingRight={1}>
        {props.label}
      </text>
      <text fg={props.color} attributes={TextAttributes.BOLD} paddingLeft={1} paddingRight={1}>
        {props.value}
      </text>
      <Show when={props.subtitle}>
        <text fg={theme.textMuted} paddingLeft={1} paddingRight={1}>
          {props.subtitle}
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
