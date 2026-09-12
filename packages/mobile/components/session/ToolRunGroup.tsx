import { useState } from "react"
import { LayoutAnimation, View } from "react-native"
import { router } from "expo-router"
import { DisclosureRow } from "@/components/ui/DisclosureRow"
import { ToolCallView } from "@/components/ToolCallView"
import { usePrefersReducedMotion } from "@/lib/animation"
import { isAgentToolName } from "@/lib/background-tasks"
import { useAppTheme } from "@/lib/theme"
import type { ToolPart } from "@/lib/types"

/** Below this a run is short enough to read in place. */
const COLLAPSE_FROM = 3

function settled(part: ToolPart): boolean {
  return part.state.status === "completed" || part.state.status === "error"
}

function childSessionID(part: ToolPart): string | undefined {
  const metadata = part.state.metadata as Record<string, unknown> | undefined
  const value = metadata?.["sessionId"]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function agentTitle(part: ToolPart): string {
  const state = part.state
  const stateTitle = state.status === "running" || state.status === "completed" ? state.title : undefined
  const input = (state.input ?? {}) as Record<string, unknown>
  const description = typeof input["description"] === "string" ? input["description"] : undefined
  return stateTitle || description || "Agent run"
}

/** The agent glyph, matching the background-activity cards. */
function AgentGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 13,
        height: 13,
        borderWidth: 1.6,
        borderColor: color,
        borderRadius: 2,
        transform: [{ rotate: "45deg" }],
      }}
    />
  )
}

/**
 * A sub-agent run, as one line in the parent transcript. Its own work belongs to
 * its own session, so the row opens that transcript rather than trying to inline it.
 */
function AgentRunRow({ part }: { part: ToolPart }) {
  const { palette } = useAppTheme()
  const child = childSessionID(part)
  const running = part.state.status === "running"

  return (
    <DisclosureRow
      icon={<AgentGlyph color={running ? palette.muted : palette.ink} />}
      emphasis="Agent run"
      label={agentTitle(part)}
      onPress={child ? () => router.push(`/sessions/${child}`) : undefined}
    />
  )
}

/** One run of consecutive non-agent tool calls, folded when it is long and finished. */
function ToolRunChunk({ tools }: { tools: ToolPart[] }) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const collapsible = tools.length >= COLLAPSE_FROM && tools.every(settled)
  const [open, setOpen] = useState(false)

  if (!collapsible) {
    return (
      <View style={{ gap: 8 }}>
        {tools.map((part) => (
          <ToolCallView key={part.id} part={part} />
        ))}
      </View>
    )
  }

  return (
    <View style={{ gap: 8 }}>
      <DisclosureRow
        emphasis="Ran"
        label={`${tools.length} commands`}
        onPress={() => {
          if (!prefersReducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
          setOpen((value) => !value)
        }}
      />
      {open ? tools.map((part) => <ToolCallView key={part.id} part={part} />) : null}
    </View>
  )
}

/**
 * The tool calls of one assistant turn, in order. A finished burst of commands
 * folds into a single line — "Ran 5 commands" — so a long turn stays readable,
 * while anything still running, and every sub-agent, keeps its own row.
 */
export function ToolRunGroup({ tools }: { tools: ToolPart[] }) {
  const blocks: Array<{ key: string; agent?: ToolPart; chunk?: ToolPart[] }> = []

  for (const part of tools) {
    if (isAgentToolName(part.tool)) {
      blocks.push({ key: part.id, agent: part })
      continue
    }
    const last = blocks[blocks.length - 1]
    if (last?.chunk) last.chunk.push(part)
    else blocks.push({ key: part.id, chunk: [part] })
  }

  return (
    <View style={{ gap: 8 }}>
      {blocks.map((block) =>
        block.agent ? (
          <AgentRunRow key={block.key} part={block.agent} />
        ) : (
          <ToolRunChunk key={block.key} tools={block.chunk ?? []} />
        ),
      )}
    </View>
  )
}
