import { useCommandDialog } from "@tui/component/dialog-command"
import { useKV } from "@tui/context/kv"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { selectedForeground, tint, useTheme } from "@tui/context/theme"
import { GlassBorderLight } from "@tui/component/border"
import { useKeybind } from "@tui/context/keybind"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { DialogSubagent } from "./dialog-subagent"
import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { AssistantMessage, TextPart, ToolPart } from "@nikcli-ai/sdk/v2"
import { Identifier } from "@/id/id"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"

type Mood = "idle" | "working" | "delegating" | "blocked" | "retrying" | "done"

type Advice = {
  codebro: CodebroID
  title: string
  lines: string[]
  sticky?: boolean
}

type CodebroID = "scout" | "plan" | "build" | "review" | "debug" | "test" | "crew"

type DiffInsight = {
  changedFiles: number
  changedLines: number
  testFiles: string[]
  configFiles: string[]
  sourceFiles: string[]
  topFiles: string[]
}

type DreamSeedMemory = {
  key: string
  rootSessionID: string
  sourceSessionID: string
  agent: string
  broName: string
  title: string
  seeds: string[]
  capturedAt: number
}

type Worker = {
  id: string
  title: string
  broName: string
  agent: string
  status: "idle" | "busy" | "retry"
  color: RGBA
}

type BroDefinition = {
  name: string
  species: string
  title: string
  tagline: string
  sprites: {
    mini: string[]
    large: string[]
  }
}

type CodebroDefinition = BroDefinition & {
  badge: string
  short: string
  scope: string
  agent: string
}

const FALLBACK_SPRITE = {
  mini: [
    "....aa....",
    "...abba...",
    "..abccba..",
    ".abccccba.",
    ".abceecba.",
    "..abddba..",
    "...abba...",
    "....aa....",
  ],
  large: [
    "......aa......",
    ".....abba.....",
    "....abccba....",
    "...abccccba...",
    "..abccffccba..",
    ".abcccffcccba.",
    ".abccceeeccba.",
    "..abccddccba..",
    "...abddddba...",
    "....abbbba....",
    ".....abba.....",
    "......aa......",
  ],
}

const BROS: Record<string, BroDefinition> = {
  build: {
    name: "DigaByte",
    species: "Dockyard Beaver",
    title: "Patch Mason",
    tagline: "Builds tidy dams out of diffs and gets suspicious when your patch starts leaking.",
    sprites: {
      mini: [
        "....aa....",
        "..aabbaa..",
        ".abccccba.",
        "abccffccba",
        "abccccccba",
        ".abddccba.",
        "..adddda..",
        "...d..d...",
      ],
      large: [
        "......aa......",
        "....aabbaa....",
        "...abccccba...",
        "..abccffccba..",
        ".abccccccccba.",
        ".abccceeeccba.",
        "..abddddddba..",
        "...adddddda...",
        "....dd..dd....",
        "....dd..dd....",
      ],
    },
  },
  plan: {
    name: "Volpiano",
    species: "Signal Fox",
    title: "Route Architect",
    tagline: "Draws the map before the sprint and side-eyes every avoidable detour.",
    sprites: {
      mini: [
        "aa......aa",
        ".ab....ba.",
        "..bccccb..",
        ".bcceeccb.",
        "abccccccba",
        "..bdddddb.",
        "...d..d...",
        "..dd..dd..",
      ],
      large: [
        "aa..........aa",
        ".ab........ba.",
        "..bcc....ccb..",
        ".abccccccccba.",
        "abcccceeecccba",
        ".bccccffffcccb.",
        "..bdddddddddb..",
        "...bdddddddb...",
        "....dd..dd....",
        "...ddd..ddd...",
      ],
    },
  },
  planner: {
    name: "Volpiano",
    species: "Signal Fox",
    title: "Route Architect",
    tagline: "Draws the map before the sprint and side-eyes every avoidable detour.",
    sprites: {
      mini: [
        "aa......aa",
        ".ab....ba.",
        "..bccccb..",
        ".bcceeccb.",
        "abccccccba",
        "..bdddddb.",
        "...d..d...",
        "..dd..dd..",
      ],
      large: [
        "aa..........aa",
        ".ab........ba.",
        "..bcc....ccb..",
        ".abccccccccba.",
        "abcccceeecccba",
        ".bccccffffcccb.",
        "..bdddddddddb..",
        "...bdddddddb...",
        "....dd..dd....",
        "...ddd..ddd...",
      ],
    },
  },
  general: {
    name: "ProcIone",
    species: "Monorepo Raccoon",
    title: "Chaos Wrangler",
    tagline: "Paws through every folder in the repo and somehow comes back with the exact right thing.",
    sprites: {
      mini: [
        "..aa..aa..",
        ".abbbbbba.",
        "abccffccba",
        "abccccccba",
        ".bcceeeccb.",
        "..bdddddb..",
        "..d....d..",
        ".dd....dd.",
      ],
      large: [
        "....aa..aa....",
        "..aabbbbbbaa..",
        ".abccffffccba.",
        "abccccccccccba",
        "abccceeeecccba",
        ".bccddddddccb.",
        "..bdddddddddb..",
        "...dd....dd...",
        "..ddd....ddd..",
        "..dd......dd..",
      ],
    },
  },
  ralph: {
    name: "Cinghio",
    species: "Charge Boar",
    title: "Loop Closer",
    tagline: "Hits the same problem again and again until only the finished task is left standing.",
    sprites: {
      mini: [
        "..aa..aa..",
        ".abbbbbba.",
        "abccccccba",
        "abceffecba",
        "abccccccba",
        ".bdddddddb.",
        "..d.dd.d..",
        ".dd....dd.",
      ],
      large: [
        "....aa..aa....",
        "..aabbbbbbaa..",
        ".abccccccccba.",
        "abcccefffcccba",
        "abccccccccccba",
        ".bccddddddddcb.",
        "..bdddddddddb..",
        "...dd.dd.dd...",
        "..ddd....ddd..",
        "..dd......dd..",
      ],
    },
  },
  "fast-explore": {
    name: "SnifFerret",
    species: "Trace Ferret",
    title: "Gap Hunter",
    tagline: "Slips through narrow code paths and returns with the exact line you forgot existed.",
    sprites: {
      mini: [
        "...aa.....",
        "..abbaa...",
        ".abccccbaa",
        "abccffccba",
        "abccccccba",
        ".abdddddba",
        "..d.....dd",
        ".d.......d",
      ],
      large: [
        ".....aa.......",
        "...aabbaa.....",
        ".aabccccbbaa..",
        "abcccffffcccba",
        "abccccccccccba",
        ".abdddddddddb.",
        "..dd.......ddd",
        ".dd..........d",
        "dd............",
      ],
    },
  },
  explore: {
    name: "SnifFerret",
    species: "Trace Ferret",
    title: "Gap Hunter",
    tagline: "Slips through narrow code paths and returns with the exact line you forgot existed.",
    sprites: {
      mini: [
        "...aa.....",
        "..abbaa...",
        ".abccccbaa",
        "abccffccba",
        "abccccccba",
        ".abdddddba",
        "..d.....dd",
        ".d.......d",
      ],
      large: [
        ".....aa.......",
        "...aabbaa.....",
        ".aabccccbbaa..",
        "abcccffffcccba",
        "abccccccccccba",
        ".abdddddddddb.",
        "..dd.......ddd",
        ".dd..........d",
        "dd............",
      ],
    },
  },
  debugger: {
    name: "Talpa Panic",
    species: "Stacktrace Mole",
    title: "Fault Digger",
    tagline: "Keeps tunneling until the bug blinks in daylight and the call stack begs for mercy.",
    sprites: {
      mini: [
        "....aa....",
        "..aabbaa..",
        ".abccccba.",
        "abccffccba",
        "abccccccba",
        ".abddddba.",
        "..dd..dd..",
        ".dd....dd.",
      ],
      large: [
        "......aa......",
        "....aabbaa....",
        "...abccccba...",
        "..abccffccba..",
        ".abccccccccba.",
        ".abccddddccba.",
        "..abddddddba..",
        "...ddd..ddd...",
        "..ddd....ddd..",
        ".ddd......ddd.",
      ],
    },
  },
  "code-reviewer": {
    name: "Gufo.exe",
    species: "Lint Owl",
    title: "Diff Auditor",
    tagline: "Perches above the patch and spots every sharp edge before prod does.",
    sprites: {
      mini: [
        "..aa..aa..",
        ".abbbbbba.",
        "abccffccba",
        "abccccccba",
        ".abceeccba",
        "..abddba..",
        "...d..d...",
        "..dd..dd..",
      ],
      large: [
        "....aa..aa....",
        "..aabbbbbbaa..",
        ".abccffffccba.",
        "abccccccccccba",
        ".abccceeeccba.",
        "..abccddccba..",
        "...abddddba...",
        "....dd..dd....",
        "...ddd..ddd...",
        "..dd......dd..",
      ],
    },
  },
  "test-runner": {
    name: "Criceto Turbo",
    species: "Loop Hamster",
    title: "Pass Chaser",
    tagline: "Runs the wheel until the output goes green and the excuses run out.",
    sprites: {
      mini: [
        "....aa....",
        "..abccba..",
        ".abccccba.",
        "abccffccba",
        "abccccccba",
        ".abddddba.",
        "..dd..dd..",
        "..d....d..",
      ],
      large: [
        "......aa......",
        "....abccba....",
        "...abccccba...",
        "..abccffccba..",
        ".abccccccccba.",
        "..abddddddba..",
        "...ddd..ddd...",
        "..ddd....ddd..",
        "..dd......dd..",
        "...d......d...",
      ],
    },
  },
  refactor: {
    name: "Criceto Turbo",
    species: "Loop Hamster",
    title: "Pass Chaser",
    tagline: "Runs the wheel until the output goes green and the excuses run out.",
    sprites: {
      mini: [
        "....aa....",
        "..abccba..",
        ".abccccba.",
        "abccffccba",
        "abccccccba",
        ".abddddba.",
        "..dd..dd..",
        "..d....d..",
      ],
      large: [
        "......aa......",
        "....abccba....",
        "...abccccba...",
        "..abccffccba..",
        ".abccccccccba.",
        "..abddddddba..",
        "...ddd..ddd...",
        "..ddd....ddd..",
        "..dd......dd..",
        "...d......d...",
      ],
    },
  },
}

const CODEBROS: Record<CodebroID, CodebroDefinition> = {
  scout: {
    ...BROS.explore,
    badge: "SC",
    short: "SCOUT",
    scope: "repo scouting",
    agent: "codebro-scout",
  },
  plan: {
    ...BROS.plan,
    badge: "PL",
    short: "PLAN",
    scope: "execution planning",
    agent: "codebro-plan",
  },
  build: {
    ...BROS.build,
    badge: "BU",
    short: "BUILD",
    scope: "patch shaping",
    agent: "codebro-build",
  },
  review: {
    ...BROS["code-reviewer"],
    badge: "AU",
    short: "AUDIT",
    scope: "diff review",
    agent: "codebro-review",
  },
  debug: {
    ...BROS.debugger,
    badge: "DG",
    short: "DEBUG",
    scope: "failure tracing",
    agent: "codebro-debug",
  },
  test: {
    ...BROS["test-runner"],
    badge: "TS",
    short: "TEST",
    scope: "verification",
    agent: "codebro-test",
  },
  crew: {
    ...BROS.general,
    badge: "CW",
    short: "CREW",
    scope: "subagent coordination",
    agent: "codebro-crew",
  },
}

const MICRO_SPRITES: Record<string, string[][]> = {
  build: [
    ["a...a", "bcccb", "ceefc", "cdddc", ".d.d."],
    [".a.a.", "bcccb", "ceefc", "cdddc", "d...d"],
  ],
  plan: [
    ["a...a", ".bcc.", "ceefc", ".cfc.", "d...d"],
    [".a.a.", "bbccb", "ceefc", ".cfc.", ".d.d."],
  ],
  planner: [
    ["a...a", ".bcc.", "ceefc", ".cfc.", "d...d"],
    [".a.a.", "bbccb", "ceefc", ".cfc.", ".d.d."],
  ],
  general: [
    ["a.a.a", "bcccb", "efffe", "cdddc", "d...d"],
    [".aaa.", "bcccb", "efffe", "ccddc", ".d.d."],
  ],
  ralph: [
    ["a.a.a", "bcccb", "cfffc", "cdddc", "d.d.d"],
    [".aaa.", "bcccb", "cfffc", "cdddc", ".ddd."],
  ],
  "fast-explore": [
    ["..aaa", "bcccb", "ceffc", ".cddc", "d...d"],
    [".aaa.", "bcccb", "ceffc", "cddc.", ".d..d"],
  ],
  explore: [
    ["..aaa", "bcccb", "ceffc", ".cddc", "d...d"],
    [".aaa.", "bcccb", "ceffc", "cddc.", ".d..d"],
  ],
  debugger: [
    [".aaa.", "bcccb", "ceefc", "cdddc", ".d.d."],
    ["..a..", "bcccb", "cfefc", "cdddc", "d...d"],
  ],
  "code-reviewer": [
    ["a...a", ".bcb.", "efffe", ".cdc.", "d...d"],
    [".a.a.", "bbbbb", "efffe", ".cdc.", ".d.d."],
  ],
  "test-runner": [
    [".aaa.", "bcccb", "efffe", "cdddc", ".d.d."],
    ["..a..", "bcccb", "efffe", "cdddc", "d...d"],
  ],
  refactor: [
    [".aaa.", "bcccb", "efffe", "cdddc", ".d.d."],
    ["..a..", "bcccb", "efffe", "cdddc", "d...d"],
  ],
}

const CODEBRO_BY_AGENT: Record<string, CodebroID> = {
  "codebro-scout": "scout",
  "codebro-plan": "plan",
  "codebro-build": "build",
  "codebro-review": "review",
  "codebro-debug": "debug",
  "codebro-test": "test",
  "codebro-crew": "crew",
  build: "build",
  plan: "plan",
  planner: "plan",
  general: "crew",
  ralph: "build",
  "fast-explore": "scout",
  explore: "scout",
  debugger: "debug",
  "code-reviewer": "review",
  "test-runner": "test",
  refactor: "test",
}

function parseSubagentFromTitle(title: string) {
  return title.match(/\(@([^\s]+)\s+subagent\)$/)?.[1]
}

function stripSubagentSuffix(title: string) {
  return title.replace(/\s*\(@[^\s]+\s+subagent\)$/, "")
}

function truncate(input: string | undefined, length: number) {
  if (!input) return undefined
  const clean = input.replace(/\s+/g, " ").trim()
  if (clean.length <= length) return clean
  return clean.slice(0, length - 1).trimEnd() + "…"
}

function shortFile(file: string) {
  const normalized = file.replace(/\\/g, "/")
  const parts = normalized.split("/")
  return parts.length <= 2 ? normalized : parts.slice(-2).join("/")
}

function extractDreamSeeds(text: string | undefined) {
  if (!text) return [] as string[]
  const match = text.match(/<dream_seeds>\s*([\s\S]*?)\s*<\/dream_seeds>/i)
  if (!match) return []
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, 3)
}

function chunk<T>(input: T[], size: number) {
  const out: T[][] = []
  for (let index = 0; index < input.length; index += size) out.push(input.slice(index, index + size))
  return out
}

function isTestFile(file: string) {
  return /(^|\/)(test|tests)\//.test(file) || /\.(test|spec)\.[^./]+$/.test(file)
}

function isConfigFile(file: string) {
  return /(^|\/)(package\.json|bunfig\.toml|tsconfig.*\.json|.*config\.[^/]+|\.env[^/]*)$/.test(file)
}

function isSourceFile(file: string) {
  return /\.(ts|tsx|js|jsx|rs|go|py)$/.test(file)
}

function moodLabel(mood: Mood) {
  switch (mood) {
    case "working":
      return "WORKING"
    case "delegating":
      return "CREW OUT"
    case "blocked":
      return "BLOCKED"
    case "retrying":
      return "RETRY"
    case "done":
      return "DONE"
    default:
      return "IDLE"
  }
}

function rarityLabel(score: number) {
  if (score >= 6) return "LEGENDARY"
  if (score >= 4) return "EPIC"
  if (score >= 3) return "RARE"
  if (score >= 2) return "UNCOMMON"
  return "COMMON"
}

function spritePalette(theme: ReturnType<typeof useTheme>["theme"], accent: RGBA, mood: Mood) {
  const liveAccent =
    mood === "retrying" ? theme.error : mood === "blocked" ? theme.warning : mood === "done" ? theme.success : accent
  const panel = theme.backgroundPanel
  return {
    a: tint(panel, liveAccent, 0.82),
    b: tint(panel, liveAccent, 0.62),
    c: tint(panel, liveAccent, 0.38),
    d: tint(panel, theme.textMuted, 0.2),
    e: theme.text,
    f: selectedForeground(theme, liveAccent),
  }
}

function spriteMiniPalette(theme: ReturnType<typeof useTheme>["theme"], accent: RGBA, mood: Mood) {
  const liveAccent =
    mood === "retrying" ? theme.error : mood === "blocked" ? theme.warning : mood === "done" ? theme.success : accent
  return {
    a: tint(theme.backgroundElement, liveAccent, 0.95),
    b: tint(theme.backgroundElement, liveAccent, 0.78),
    c: tint(theme.backgroundElement, liveAccent, 0.58),
    d: tint(theme.backgroundElement, theme.text, 0.55),
    e: theme.text,
    f: selectedForeground(theme, liveAccent),
  }
}

function downsampleSprite(sprite: string[]) {
  return sprite
    .filter((_, row) => row % 2 === 0)
    .map((row) =>
      row
        .split("")
        .filter((_, col) => col % 2 === 0)
        .join(""),
    )
}

function microSpriteFrame(frames: string[][], mood: Mood, tick: number) {
  if (frames.length === 1) return frames[0]!
  switch (mood) {
    case "working":
    case "delegating":
      return frames[Math.floor(tick / 2) % frames.length]!
    case "retrying":
      return frames[Math.floor(tick) % frames.length]!
    case "blocked":
      return frames[frames.length - 1]!
    case "done":
      return frames[0]!
    default:
      return tick % 8 === 6 ? frames[1]! : frames[0]!
  }
}

function stretchMicroSprite(sprite: string[]) {
  return sprite.map((row) => {
    if (row.length !== 5) return row
    return row[0] + row[1] + row[1] + row[2] + row[3] + row[3] + row[4]
  })
}

function clampSpriteHeight(sprite: string[], maxHeight = 4) {
  if (sprite.length <= maxHeight) return sprite
  const last = sprite.length - 1
  return Array.from({ length: maxHeight }, (_, index) => sprite[Math.round((index * last) / (maxHeight - 1))]!)
}

function codebroForAgent(agent: string) {
  return CODEBROS[CODEBRO_BY_AGENT[agent] ?? "crew"]
}

function dispatchRequest(codebro: CodebroDefinition, stats: DiffInsight) {
  const focus = stats.topFiles.length > 0 ? stats.topFiles.join(", ") : "the current diff and conversation context"
  const learning =
    "While working, learn durable signals about how nikcli operates, how the user prefers to work, what level of verification they expect, and what workflow patterns repeat. Emit any durable findings as <dream_seeds> bullets at the end."
  switch (codebro.agent) {
    case "codebro-scout":
      return {
        description: "Scout hot path",
        prompt: `Use the task tool now to dispatch a @codebro-scout subagent in the background. Description: Scout hot path. Prompt: Inspect ${focus}. Find the highest-leverage file path to read next, the main risk surface, and the shortest route to understanding the change. ${learning}`,
      }
    case "codebro-plan":
      return {
        description: "Plan next slice",
        prompt: `Use the task tool now to dispatch a @codebro-plan subagent in the background. Description: Plan next slice. Prompt: Review ${focus} and propose the cleanest next implementation slice, dependencies, and the safest execution order. ${learning}`,
      }
    case "codebro-build":
      return {
        description: "Shape next patch",
        prompt: `Use the task tool now to dispatch a @codebro-build subagent in the background. Description: Shape next patch. Prompt: Review ${focus}. Recommend the smallest safe patch to land next and the command or verification path that should follow. ${learning}`,
      }
    case "codebro-review":
      return {
        description: "Review changed diff",
        prompt: `Use the task tool now to dispatch a @codebro-review subagent in the background. Description: Review changed diff. Prompt: Audit ${focus}. Surface regressions, edge cases, and any follow-up checks the main agent should not skip. ${learning}`,
      }
    case "codebro-debug":
      return {
        description: "Trace failing path",
        prompt: `Use the task tool now to dispatch a @codebro-debug subagent in the background. Description: Trace failing path. Prompt: Investigate ${focus}. Find the most likely failing surface, what evidence to inspect first, and the smallest fix path. ${learning}`,
      }
    case "codebro-test":
      return {
        description: "Verify change set",
        prompt: `Use the task tool now to dispatch a @codebro-test subagent in the background. Description: Verify change set. Prompt: Check ${focus}. Recommend the tightest verification strategy, likely failing tests, and any missing coverage worth adding. ${learning}`,
      }
    default:
      return {
        description: "Coordinate codebros",
        prompt: `Use the task tool now to dispatch a @codebro-crew subagent in the background. Description: Coordinate codebros. Prompt: Review ${focus}. Decide which specialist should work next and what exact task they should take. ${learning}`,
      }
  }
}

function workerMood(status: Worker["status"]): Mood {
  if (status === "retry") return "retrying"
  if (status === "busy") return "working"
  return "idle"
}

function workerStatusGlyph(status: Worker["status"]) {
  if (status === "retry") return "!"
  if (status === "busy") return "*"
  return "·"
}

function PixelSprite(props: {
  sprite: string[]
  palette: Record<string, RGBA>
  scale?: number
  pixelWidth?: number
  background?: RGBA
}) {
  const scale = props.scale ?? 1
  const width = props.pixelWidth ?? scale * 2
  return (
    <box flexDirection="column" gap={0} backgroundColor={props.background}>
      <For each={props.sprite}>
        {(row) => (
          <For each={Array.from({ length: scale })}>
            {() => (
              <box flexDirection="row" gap={0}>
                <For each={row.split("")}>
                  {(cell) => (
                    <box
                      width={width}
                      height={1}
                      backgroundColor={cell === "." ? props.background : props.palette[cell]}
                    />
                  )}
                </For>
              </box>
            )}
          </For>
        )}
      </For>
    </box>
  )
}

function MiniCodebroTile(props: {
  definition: CodebroDefinition
  accent: RGBA
  mood: Mood
  tick: number
  pixelWidth?: number
  stretch?: boolean
  statusGlyph?: string
  statusTone?: "idle" | "busy" | "retry"
}) {
  const { theme } = useTheme()
  const sprite = createMemo(() => {
    const frames = MICRO_SPRITES[props.definition.agent] ?? [downsampleSprite(props.definition.sprites.mini)]
    const frame = microSpriteFrame(frames, props.mood, props.tick)
    const shaped = props.stretch ? stretchMicroSprite(frame) : frame
    return clampSpriteHeight(shaped, 4)
  })
  const palette = createMemo(() => spriteMiniPalette(theme, props.accent, props.mood))

  return <PixelSprite sprite={sprite()} palette={palette()} pixelWidth={props.pixelWidth ?? 1} />
}

function LeadCodebroTile(props: {
  definition: CodebroDefinition
  accent: RGBA
  mood: Mood
  statusGlyph?: string
  statusTone?: "idle" | "busy" | "retry"
}) {
  const { theme } = useTheme()
  const palette = createMemo(() => spriteMiniPalette(theme, props.accent, props.mood))
  const sprite = createMemo(() => clampSpriteHeight(props.definition.sprites.mini, 4))

  return <PixelSprite sprite={sprite()} palette={palette()} pixelWidth={1} />
}

function ActionChip(props: { label: string; accent: RGBA; onPress: () => void }) {
  const { theme } = useTheme()
  const bg = createMemo(() => tint(theme.backgroundElement, props.accent, 0.14))
  return (
    <box
      border={[...GlassBorderLight.border]}
      customBorderChars={GlassBorderLight.customBorderChars}
      borderColor={props.accent}
      backgroundColor={bg()}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={props.onPress}
    >
      <text fg={props.accent}>
        <b>{props.label}</b>
      </text>
    </box>
  )
}

function CodebroDispatchDialog(props: { sessionID: string; stats: DiffInsight }) {
  const local = useLocal()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()

  return (
    <DialogSelect
      title="Dispatch Codebro"
      options={Object.entries(CODEBROS).map(([id, codebro]) => ({
        title: `${codebro.short} · ${codebro.name}`,
        value: id,
        description: codebro.scope,
        bg: local.agent.color(codebro.agent),
        gutter: <text fg={local.agent.color(codebro.agent)}>@{codebro.agent}</text>,
        onSelect: () => {
          const selectedModel = local.model.current()
          if (!selectedModel) {
            toast.show({ variant: "warning", message: "Select a model before dispatching a Codebro", duration: 3000 })
            return
          }
          const request = dispatchRequest(codebro, props.stats)
          sdk.client.session
            .prompt({
              sessionID: props.sessionID,
              ...selectedModel,
              messageID: Identifier.ascending("message"),
              agent: "crew",
              model: selectedModel,
              variant: local.model.variant.current(),
              parts: [
                {
                  id: Identifier.ascending("part"),
                  type: "text",
                  text: request.prompt,
                },
              ],
            })
            .then(() => {
              toast.show({
                variant: "success",
                message: `${codebro.name} dispatched with ${request.description.toLowerCase()}`,
                duration: 3000,
              })
            })
            .catch(toast.error)
          dialog.clear()
        },
      }))}
    />
  )
}

function Stat(props: { label: string; value: string; accent?: RGBA }) {
  const { theme } = useTheme()
  const backgroundColor = createMemo(() => {
    if (!props.accent) return theme.backgroundPanel
    return tint(theme.backgroundPanel, props.accent, 0.12)
  })
  return (
    <box
      flexDirection="column"
      gap={0}
      backgroundColor={backgroundColor()}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
    >
      <text fg={theme.textMuted}>{props.label}</text>
      <text fg={theme.text}>
        <b>{props.value}</b>
      </text>
    </box>
  )
}

function CodebroDossier(props: {
  sessionID: string
  definition: BroDefinition
  accent: RGBA
  mood: Mood
  rarity: string
  advice: Advice
  lastSaid?: string
  roleLabel: string
  status: string
  workerCount: number
  stats: {
    contextPct: number | null
    cost: string
    files: number
    todos: number
    waiting: number
  }
  workers: Worker[]
  onOpenWorker: (workerID: string) => void
  onOpenCrew: () => void
  onDispatch: () => void
}) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const palette = createMemo(() => spritePalette(theme, props.accent, props.mood))
  const accentBg = createMemo(() => tint(theme.backgroundPanel, props.accent, 0.16))
  const workerColumns = createMemo(() => (dimensions().width >= 150 ? 2 : 1))
  const workerRows = createMemo(() => chunk(props.workers, workerColumns()))
  const workerCardWidth = createMemo(() => (workerColumns() === 2 ? 48 : Math.max(48, dimensions().width - 24)))

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection={dimensions().width >= 120 ? "row" : "column"} justifyContent="space-between" gap={1}>
        <box flexDirection="row" gap={1}>
          <text fg={props.accent}>
            <b>{props.rarity}</b>
          </text>
          <text fg={theme.textMuted}>{props.definition.species.toUpperCase()}</text>
        </box>
        <text fg={theme.textMuted}>{props.roleLabel}</text>
      </box>

      <box flexDirection={dimensions().width >= 120 ? "row" : "column"} gap={2}>
        <box
          border={[...GlassBorderLight.border]}
          customBorderChars={GlassBorderLight.customBorderChars}
          borderColor={props.accent}
          backgroundColor={accentBg()}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={1}
          paddingRight={1}
          flexShrink={0}
        >
          <PixelSprite sprite={props.definition.sprites.large} palette={palette()} scale={1} background={accentBg()} />
        </box>

        <box flexDirection="column" gap={1} flexGrow={1} minWidth={0}>
          <box flexDirection="column">
            <text fg={theme.text}>
              <b>{props.definition.name}</b>
            </text>
            <text fg={theme.textMuted}>
              {props.definition.title} · {props.status}
            </text>
          </box>

          <text fg={theme.text}>{props.definition.tagline}</text>

          <box flexDirection="row" gap={1}>
            <Stat
              label="CTX"
              value={props.stats.contextPct == null ? "--" : `${props.stats.contextPct}%`}
              accent={props.accent}
            />
            <Stat label="COST" value={props.stats.cost} accent={props.accent} />
            <Stat label="FILES" value={String(props.stats.files)} accent={props.accent} />
          </box>
          <box flexDirection="row" gap={1}>
            <Stat label="TODO" value={String(props.stats.todos)} accent={props.accent} />
            <Stat label="WAIT" value={String(props.stats.waiting)} accent={props.accent} />
            <Stat label="CREW" value={String(props.workerCount)} accent={props.accent} />
          </box>
        </box>
      </box>

      <box
        border={[...GlassBorderLight.border]}
        customBorderChars={GlassBorderLight.customBorderChars}
        borderColor={props.accent}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="column" gap={0}>
          <text fg={props.accent}>
            <b>{props.advice.title}</b>
          </text>
          <For each={props.advice.lines}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
        </box>
      </box>

      <box
        border={[...GlassBorderLight.border]}
        customBorderChars={GlassBorderLight.customBorderChars}
        borderColor={theme.borderSubtle}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="column" gap={0}>
          <text fg={theme.textMuted}>last said</text>
          <text fg={theme.text}>{props.lastSaid ?? "No spoken lines yet. Still watching the session."}</text>
        </box>
      </box>

      <Show when={props.workers.length > 0}>
        <box
          border={[...GlassBorderLight.border]}
          customBorderChars={GlassBorderLight.customBorderChars}
          borderColor={theme.borderSubtle}
          backgroundColor={theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexDirection="column" gap={1}>
            <text fg={theme.textMuted}>active codebros</text>
            <For each={workerRows()}>
              {(row) => (
                <box flexDirection="row" gap={1}>
                  <For each={row}>
                    {(worker) => {
                      const workerCodebro = codebroForAgent(worker.agent)
                      return (
                        <box
                          flexDirection="row"
                          gap={1}
                          width={workerCardWidth()}
                          border={[...GlassBorderLight.border]}
                          customBorderChars={GlassBorderLight.customBorderChars}
                          borderColor={worker.color}
                          backgroundColor={tint(theme.backgroundElement, worker.color, 0.12)}
                          paddingLeft={1}
                          paddingRight={1}
                          onMouseUp={() => props.onOpenWorker(worker.id)}
                        >
                          <MiniCodebroTile
                            definition={workerCodebro}
                            accent={worker.color}
                            mood={workerMood(worker.status)}
                            tick={0}
                            statusGlyph={workerStatusGlyph(worker.status)}
                            statusTone={worker.status}
                          />
                          <box flexDirection="column" gap={0} flexGrow={1}>
                            <text fg={theme.text}>
                              <b>{workerCodebro.name}</b>
                            </text>
                            <text fg={theme.textMuted}>{worker.title}</text>
                            <text
                              fg={
                                worker.status === "retry"
                                  ? theme.error
                                  : worker.status === "busy"
                                    ? worker.color
                                    : theme.textMuted
                              }
                            >
                              @{worker.agent} · {worker.status}
                            </text>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </box>
              )}
            </For>
          </box>
        </box>
      </Show>

      <box flexDirection="row" gap={1}>
        <ActionChip label="dispatch" accent={props.accent} onPress={props.onDispatch} />
        <ActionChip label="crew" accent={props.accent} onPress={props.onOpenCrew} />
      </box>

      <text fg={theme.textMuted}>esc close · /bro reopen</text>
    </box>
  )
}

export function SessionCodebroSide(props: { sessionID: string }) {
  const sync = useSync()
  const local = useLocal()
  const kv = useKV()
  const route = useRoute()
  const toast = useToast()
  const dialog = useDialog()
  const command = useCommandDialog()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const rootID = createMemo(() => session()?.parentID ?? props.sessionID)
  const family = createMemo(() => {
    const id = rootID()
    return sync.data.session.filter((item) => item.id === id || item.parentID === id)
  })
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todos = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const compact = createMemo(() => dimensions().width < 110)

  const backgroundedIDs = createMemo(() => {
    const map = (kv.get("background_subtasks", {}) ?? {}) as Record<string, string[]>
    return map[rootID()] ?? []
  })

  const pending = createMemo(() => {
    return family().reduce(
      (acc, item) => {
        acc.permission += sync.data.permission[item.id]?.length ?? 0
        acc.question += sync.data.question[item.id]?.length ?? 0
        acc.dbedit += sync.data.dbedit[item.id]?.length ?? 0
        return acc
      },
      { permission: 0, question: 0, dbedit: 0 },
    )
  })

  const lastAssistant = createMemo(
    () => messages().findLast((item) => item.role === "assistant") as AssistantMessage | undefined,
  )
  const sessionAgent = createMemo(() => {
    const fromTitle = session()?.title ? parseSubagentFromTitle(session()!.title) : undefined
    if (fromTitle) return fromTitle
    const fromMessage = lastAssistant()?.agent
    if (fromMessage) return fromMessage
    return local.agent.current().name
  })
  const status = createMemo(() => sync.data.session_status?.[props.sessionID] ?? { type: "idle" as const })

  const workers = createMemo<Worker[]>(() => {
    const weight = (status: Worker["status"]) => {
      if (status === "retry") return 0
      if (status === "busy") return 1
      return 2
    }
    return sync.data.session
      .filter((item) => item.parentID === rootID())
      .filter((item) => {
        const childStatus = sync.data.session_status[item.id]?.type ?? "idle"
        return childStatus !== "idle" || backgroundedIDs().includes(item.id)
      })
      .map((item) => {
        const agent = parseSubagentFromTitle(item.title) ?? "general"
        const def = BROS[agent] ?? BROS[sessionAgent()] ?? BROS.general
        const workerStatus = sync.data.session_status[item.id]?.type ?? "idle"
        return {
          id: item.id,
          title: stripSubagentSuffix(item.title),
          broName: def.name,
          agent,
          status: (workerStatus === "retry" ? "retry" : workerStatus === "busy" ? "busy" : "idle") as Worker["status"],
          color: local.agent.color(agent),
        }
      })
      .toSorted((a, b) => weight(a.status) - weight(b.status) || a.title.localeCompare(b.title))
  })

  const contextInfo = createMemo(() => {
    const last = lastAssistant()
    if (!last || last.tokens.output <= 0) return { pct: null as number | null, cost: "$0.00" }
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      pct: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
      cost: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
        messages().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0),
      ),
    }
  })

  const diffInsight = createMemo<DiffInsight>(() => {
    const files = diff()
    const sorted = [...files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    return {
      changedFiles: files.length,
      changedLines: files.reduce((sum, item) => sum + item.additions + item.deletions, 0),
      testFiles: files.map((item) => item.file).filter(isTestFile),
      configFiles: files.map((item) => item.file).filter(isConfigFile),
      sourceFiles: files.map((item) => item.file).filter(isSourceFile),
      topFiles: sorted.slice(0, 3).map((item) => shortFile(item.file)),
    }
  })

  const lastSaid = createMemo(() => {
    const msg = lastAssistant()
    if (!msg) return undefined
    const text = (sync.data.part[msg.id] ?? [])
      .filter((part) => part.type === "text")
      .map((part) => (part as TextPart).text)
      .join(" ")
    return truncate(text, compact() ? 72 : 132)
  })

  const dreamMemories = createMemo(() => (kv.get("codebro_dream_seeds", []) ?? []) as DreamSeedMemory[])
  const dreamCaptureEnabled = createMemo(() => kv.get("dream_enabled", true) && kv.get("dream_memory_enabled", true))
  const workerDreamCandidates = createMemo<DreamSeedMemory[]>(() => {
    return family()
      .filter((item) => item.parentID === rootID())
      .flatMap((child) => {
        const agent = parseSubagentFromTitle(child.title) ?? "general"
        const workerCodebro = codebroForAgent(agent)
        const last = (sync.data.message[child.id] ?? []).findLast((item) => item.role === "assistant") as
          | AssistantMessage
          | undefined
        if (!last) return []
        const text = (sync.data.part[last.id] ?? [])
          .filter((part) => part.type === "text")
          .map((part) => (part as TextPart).text)
          .join(" ")
        const seeds = extractDreamSeeds(text)
        if (!seeds.length) return []
        return [
          {
            key: `${child.id}:${last.id}`,
            rootSessionID: rootID(),
            sourceSessionID: child.id,
            agent,
            broName: workerCodebro.name,
            title: stripSubagentSuffix(child.title),
            seeds,
            capturedAt: Date.now(),
          },
        ]
      })
  })

  createEffect(() => {
    if (!dreamCaptureEnabled()) return
    const existing = dreamMemories()
    const seen = new Set(existing.map((item) => item.key))
    const seenSeedText = new Set(
      existing.flatMap((item) => item.seeds.map((seed) => `${item.rootSessionID}:${seed.toLowerCase()}`)),
    )
    const incoming = workerDreamCandidates().filter((item) => {
      if (seen.has(item.key)) return false
      const uniqueSeeds = item.seeds.filter((seed) => {
        const key = `${item.rootSessionID}:${seed.toLowerCase()}`
        if (seenSeedText.has(key)) return false
        seenSeedText.add(key)
        return true
      })
      item.seeds = uniqueSeeds
      return uniqueSeeds.length > 0
    })
    if (incoming.length === 0) return
    kv.set("codebro_dream_seeds", [...incoming, ...existing].slice(0, 80))
  })

  const rootDreamMemories = createMemo(() => dreamMemories().filter((item) => item.rootSessionID === rootID()))
  const latestDreamMemory = createMemo(() => rootDreamMemories()[0])

  const latestToolError = createMemo(() => {
    for (const message of [...messages()].reverse()) {
      if (message.role !== "assistant") continue
      const parts = sync.data.part[message.id] ?? []
      for (const part of [...parts].reverse()) {
        if (part.type !== "tool") continue
        const tool = part as ToolPart
        if (tool.state.status !== "error") continue
        return tool
      }
    }
  })

  const mood = createMemo<Mood>(() => {
    if (status().type === "retry") return "retrying"
    if (pending().permission + pending().question + pending().dbedit > 0) return "blocked"
    if (status().type === "busy" && workers().length > 0) return "delegating"
    if (status().type === "busy") return "working"
    if (diff().length > 0 && todos().filter((item) => item.status !== "completed").length === 0) return "done"
    return "idle"
  })

  const rarity = createMemo(() => {
    let score = 0
    if (status().type === "retry") score += 2
    if (status().type === "busy") score += 1
    score += pending().permission > 0 ? 1 : 0
    score += pending().question > 0 ? 1 : 0
    score += pending().dbedit > 0 ? 1 : 0
    score += workers().length > 0 ? 1 : 0
    score += diff().length >= 5 ? 1 : 0
    score += (contextInfo().pct ?? 0) >= 75 ? 1 : 0
    return rarityLabel(score)
  })

  const [tipTick, setTipTick] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => setTipTick((value) => value + 1), 1250)
    onCleanup(() => clearInterval(timer))
  })

  const rotatingAdvice = createMemo<Advice[]>(() => {
    const hint = keybind.print("session_codebro_open")
    const stats = diffInsight()
    const openTodos = todos().filter((item) => item.status !== "completed").length
    const tips: Advice[] = []

    if (workers().length > 0) {
      tips.push({
        codebro: "crew",
        title: "Crew in the field",
        lines: [
          `${workers().length} worker${workers().length > 1 ? "s" : ""} active off-thread.`,
          `Use ${hint} to inspect the dossier and recent work.`,
        ],
      })
    }

    if ((contextInfo().pct ?? 0) >= 80) {
      tips.push({
        codebro: "plan",
        title: "Context is getting hot",
        lines: [`Window is ${contextInfo().pct}% full.`, "Compact or split before the next long turn."],
      })
    }

    if (stats.changedLines >= 120) {
      tips.push({
        codebro: "build",
        title: "Patch has mass",
        lines: [`${stats.changedLines} diff lines moved.`, "Land a clean slice before the blast radius grows."],
      })
    }

    if (stats.changedFiles >= 5) {
      tips.push({
        codebro: "review",
        title: "Patch got chunky",
        lines: [
          `${stats.changedFiles} files and ${stats.changedLines} lines moved.`,
          "Good moment for typecheck or a review pass.",
        ],
      })
    }

    if (stats.configFiles.length > 0) {
      tips.push({
        codebro: "review",
        title: "Config surface moved",
        lines: [`Watch ${shortFile(stats.configFiles[0])}.`, "Defaults and flags are easy places to nick yourself."],
      })
    }

    if (stats.sourceFiles.length >= 3 && stats.testFiles.length === 0) {
      tips.push({
        codebro: "test",
        title: "No tests nearby yet",
        lines: ["Source changed without test coverage in the diff.", "A targeted test pass would de-risk this slice."],
      })
    }

    if (stats.topFiles.length > 0) {
      tips.push({
        codebro: "scout",
        title: "Hottest file",
        lines: [`${stats.topFiles[0]} carries the heaviest change.`, "That is the best place to sanity-check next."],
      })
    }

    if (rootDreamMemories().length > 0) {
      tips.push({
        codebro: "crew",
        title: "Dream seeds saved",
        lines: [
          `${rootDreamMemories().length} memory seed${rootDreamMemories().length > 1 ? "s" : ""} captured from background runs.`,
          truncate(latestDreamMemory()?.seeds[0], 64) ?? "Use /dream to consolidate them into durable memory.",
        ],
      })
    }

    if (stats.topFiles.length > 1) {
      tips.push({
        codebro: "plan",
        title: "Planning cut",
        lines: [
          `Split around ${stats.topFiles.slice(0, 2).join(" + ")}.`,
          "That looks like the cleanest execution seam.",
        ],
      })
    }

    if (stats.changedFiles >= 4 && workers().length === 0) {
      tips.push({
        codebro: "crew",
        title: "Specialize the sweep",
        lines: ["This spread is broad for one pass.", "Spawn a scout or reviewer before the next swing."],
      })
    }

    if (stats.changedFiles > 0) {
      tips.push({
        codebro: "build",
        title: "Builder read",
        lines: [
          `${stats.changedFiles} file${stats.changedFiles > 1 ? "s" : ""} touched.`,
          "Verify the narrowest green path before another edit.",
        ],
      })
    }

    if (stats.configFiles.length > 0 || stats.changedFiles >= 4) {
      tips.push({
        codebro: "review",
        title: "Review pass",
        lines: ["Scan config and high-churn files first.", "That is usually where regressions hide."],
      })
    }

    if (stats.topFiles.length > 0) {
      tips.push({
        codebro: "scout",
        title: "Scout route",
        lines: [
          `Trace ${stats.topFiles[0]} outward before reading everything.`,
          "The surrounding imports should tell the story faster.",
        ],
      })
    }

    if (latestToolError()) {
      tips.push({
        codebro: "debug",
        title: "Debugger instinct",
        lines: ["Prefer the failing surface over a fresh patch.", "Repro, inspect, then cut the smallest fix."],
      })
    }

    if (openTodos > 0) {
      tips.push({
        codebro: "plan",
        title: "Objectives still lit",
        lines: [`${openTodos} todo${openTodos > 1 ? "s" : ""} still open.`, "Close one before spawning fresh chaos."],
      })
    }

    if (tips.length === 0) {
      tips.push({
        codebro: "scout",
        title: `${CODEBROS.scout.name} is docked`,
        lines: [
          truncate(lastSaid(), 44) ?? "Quiet lane. Waiting for the next move.",
          `${hint} opens the full dossier.`,
        ],
      })
    }

    return tips
  })

  const advice = createMemo<Advice>(() => {
    const hint = keybind.print("session_codebro_open")
    if (status().type === "retry") {
      return {
        codebro: "debug",
        title: `${CODEBROS.debug.name} caught turbulence`,
        lines: ["Provider turbulence detected.", `Let the loop breathe, then pop ${hint} for the full case file.`],
        sticky: true,
      }
    }
    if (pending().permission > 0) {
      return {
        codebro: "review",
        title: "Need operator clearance",
        lines: [
          `${pending().permission} permission gate${pending().permission > 1 ? "s" : ""} waiting.`,
          "Approve or reroute before I send the crew deeper.",
        ],
        sticky: true,
      }
    }
    if (pending().question > 0) {
      return {
        codebro: "plan",
        title: "Need your input",
        lines: [
          `${pending().question} question${pending().question > 1 ? "s" : ""} still open.`,
          "A quick answer will unlock the next move.",
        ],
        sticky: true,
      }
    }
    if (pending().dbedit > 0) {
      return {
        codebro: "review",
        title: "Schema on hold",
        lines: [`${pending().dbedit} db edit request pending.`, "Review the change before more writes pile up."],
        sticky: true,
      }
    }
    if (latestToolError()) {
      return {
        codebro: "debug",
        title: `Tool ${latestToolError()!.tool} failed`,
        lines: ["Inspect the last error before patching further.", "This usually pays off faster than guessing."],
        sticky: true,
      }
    }
    const candidates = rotatingAdvice()
    return candidates[Math.floor(tipTick() / 6) % candidates.length]!
  })

  const definition = createMemo(() => CODEBROS[advice().codebro] ?? CODEBROS.scout)
  const accent = createMemo(() => local.agent.color(definition().agent))
  const visibleWorkers = createMemo(() => workers().slice(0, compact() ? 0 : 1))
  const overflowWorkers = createMemo(() => Math.max(0, workers().length - visibleWorkers().length))

  const bubbleColor = createMemo(() => {
    if (advice().sticky) {
      if (status().type === "retry") return theme.error
      if (pending().permission + pending().question + pending().dbedit > 0) return theme.warning
      if (latestToolError()) return theme.error
    }
    return accent()
  })
  const bubbleText = createMemo(() => truncate(advice().lines[0] ?? advice().title, compact() ? 22 : 28))

  const showBubble = createMemo(() => {
    if (advice().sticky) return true
    return tipTick() % 12 < 4
  })

  const openDossier = () => {
    const openWorker = (workerID: string) => {
      dialog.clear()
      route.navigate({
        type: "session",
        sessionID: workerID,
        workspaceID: sync.session.get(workerID)?.workspaceID,
      })
    }
    const openCrew = () => {
      dialog.replace(() => <DialogSubagent sessionID={rootID()} />)
    }
    const openDispatch = () => {
      dialog.replace(() => <CodebroDispatchDialog sessionID={rootID()} stats={diffInsight()} />)
    }

    dialog.replace(() => (
      <CodebroDossier
        sessionID={props.sessionID}
        definition={definition()}
        accent={accent()}
        mood={mood()}
        rarity={rarity()}
        advice={advice()}
        lastSaid={lastSaid()}
        roleLabel={`INDEPENDENT SUBAGENT · ${definition().scope}`}
        status={moodLabel(mood())}
        workerCount={workers().length}
        stats={{
          contextPct: contextInfo().pct,
          cost: contextInfo().cost,
          files: diff().length,
          todos: todos().filter((item) => item.status !== "completed").length,
          waiting: pending().permission + pending().question + pending().dbedit,
        }}
        workers={workers()}
        onOpenWorker={openWorker}
        onOpenCrew={openCrew}
        onDispatch={openDispatch}
      />
    ))
    dialog.setSize("xlarge")
  }

  command.register(() => [
    {
      title: "Open Codebro dossier",
      value: "session.codebro.open",
      keybind: "session_codebro_open",
      category: "Session",
      slash: {
        name: "bro",
        aliases: ["codebro"],
      },
      onSelect: () => openDossier(),
    },
    {
      title: "Run dream consolidation",
      value: "session.codebro.dream",
      category: "Session",
      slash: {
        name: "dream",
      },
      onSelect: async () => {
        const { Dream } = await import("@/dream")
        const result = await Dream.trigger()
        if (!result.success) {
          toast.show({
            variant: "warning",
            message: result.error ?? "Dream did not run",
            duration: 3000,
          })
          return
        }
        toast.show({
          variant: "success",
          message: `Dream consolidated ${result.sessionsReviewed} session${result.sessionsReviewed === 1 ? "" : "s"}`,
          duration: 3000,
        })
      },
    },
  ])

  return (
    <Show when={session()}>
      <box width={compact() ? 12 : 18} flexDirection="column" alignItems="flex-end" gap={0} zIndex={30}>
        <Show when={showBubble()}>
          <text fg={bubbleColor()}>{bubbleText()}</text>
        </Show>
        <box flexDirection="row" alignItems="flex-end" justifyContent="flex-end" gap={1} onMouseUp={openDossier}>
          <LeadCodebroTile
            definition={definition()}
            accent={accent()}
            mood={mood()}
            statusGlyph={advice().sticky ? workerStatusGlyph(status().type === "retry" ? "retry" : "busy") : undefined}
            statusTone={advice().sticky ? (status().type === "retry" ? "retry" : "busy") : undefined}
          />
          <For each={visibleWorkers()}>
            {(worker) => {
              const workerCodebro = codebroForAgent(worker.agent)
              return (
                <MiniCodebroTile
                  definition={workerCodebro}
                  accent={worker.color}
                  mood={workerMood(worker.status)}
                  tick={tipTick()}
                  statusGlyph={workerStatusGlyph(worker.status)}
                  statusTone={worker.status}
                />
              )
            }}
          </For>
          <Show when={overflowWorkers() > 0}>
            <text fg={theme.textMuted}>+{overflowWorkers()}</text>
          </Show>
        </box>
      </box>
    </Show>
  )
}
