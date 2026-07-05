import { TextAttributes, RGBA } from "@opentui/core"
import { useTimeline } from "@opentui/solid"
import { createSignal, For, onMount, Show } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import { Link } from "@tui/ui/link"

const LOGO_LINES = [
  "███╗   ██╗ ██╗ ██╗  ██╗  ██████╗ ██╗      ██╗",
  "████╗  ██║ ██║ ██║ ██╔╝ ██╔════╝ ██║      ██║",
  "██╔██╗ ██║ ██║ █████╔╝  ██║      ██║      ██║",
  "██║╚██╗██║ ██║ ██╔═██╗  ██║      ██║      ██║",
  "██║ ╚████║ ██║ ██║  ██╗ ╚██████╗ ███████╗ ██║",
  "╚═╝  ╚═══╝ ╚═╝ ╚═╝  ╚═╝  ╚═════╝ ╚══════╝ ╚═╝",
]

const LOGO_WIDTH = Math.max(...LOGO_LINES.map((line) => line.length))
const REVEAL_DURATION = 950
const SHINE_WIDTH = 5
const ROW_LUMINANCE = [0.48, 0.62, 0.82, 1, 0.72, 0.5]
const CREDIT = "by nikomatt69"
const GITHUB_PROFILE_URL = "https://github.com/nikomatt69"

type Segment = {
  text: string
  color: RGBA
  bold: boolean
}

export function Logo(props: { idle?: boolean }) {
  const { theme } = useTheme()
  const kv = useKV()
  const animationsEnabled = props.idle !== false && kv.get("animations_enabled", true)
  const [progress, setProgress] = createSignal(animationsEnabled ? 0 : 1)
  const timeline = useTimeline({ duration: REVEAL_DURATION, autoplay: animationsEnabled })

  onMount(() => {
    if (!animationsEnabled) return
    timeline.add(
      { progress: 0 },
      {
        progress: 1,
        duration: REVEAL_DURATION,
        ease: "inOutSine",
        onUpdate: (animation) => setProgress(animation.targets[0].progress),
      },
    )
  })

  const renderLine = (line: string, row: number): Segment[] => {
    const cursor = Math.floor(progress() * (LOGO_WIDTH + SHINE_WIDTH))
    const edge = Math.min(LOGO_WIDTH, cursor)
    const shineStart = Math.min(LOGO_WIDTH, Math.max(0, cursor - SHINE_WIDTH))
    const base = tint(theme.textMuted, theme.text, ROW_LUMINANCE[row] ?? 0.7)
    const segments: Segment[] = []

    if (shineStart > 0) {
      segments.push({
        text: line.slice(0, shineStart),
        color: base,
        bold: row >= 2 && row <= 4,
      })
    }

    if (edge > shineStart) {
      segments.push({
        text: line.slice(shineStart, edge),
        color: tint(base, theme.text, 0.9),
        bold: true,
      })
    }

    if (edge < LOGO_WIDTH) {
      segments.push({
        text: " ".repeat(LOGO_WIDTH - edge),
        color: theme.background,
        bold: false,
      })
    }

    return segments
  }

  const diamondStrength = () => {
    const value = progress()
    if (value < 0.86) return 0
    if (value < 0.96) return (value - 0.86) / 0.1
    return 1 - ((value - 0.96) / 0.04) * 0.35
  }

  return (
    <box width={LOGO_WIDTH}>
      <For each={LOGO_LINES}>
        {(line, index) => (
          <box flexDirection="row" height={1}>
            <For each={renderLine(line, index())}>
              {(segment) => (
                <text
                  fg={segment.color}
                  attributes={segment.bold ? TextAttributes.BOLD : undefined}
                  selectable={false}
                >
                  {segment.text}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
      <box width={LOGO_WIDTH} height={1} flexDirection="row" justifyContent="center" gap={1}>
        <text
          fg={tint(theme.background, theme.text, diamondStrength())}
          attributes={TextAttributes.BOLD}
          selectable={false}
        >
          {progress() >= 0.86 ? "◇" : " "}
        </text>
        <Show
          when={progress() >= 0.86}
          fallback={
            <text fg={theme.background} selectable={false}>
              {" ".repeat(CREDIT.length)}
            </text>
          }
        >
          <Link href={GITHUB_PROFILE_URL} fg={theme.info} underline={false}>
            {CREDIT}
          </Link>
        </Show>
      </box>
    </box>
  )
}
