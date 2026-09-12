import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import { Square, SquareTerminal, X } from "lucide-react-native"
import { SheetShell, useSheetScrollProps } from "@/components/ui/SheetShell"
import { CollapsibleSection } from "@/components/ui/CollapsibleSection"
import { IconCircleButton } from "@/components/ui/IconCircleButton"
import { EmptyState } from "@/components/ui/EmptyState"
import {
  durationLabel,
  finishedTasks,
  formatTokenCount,
  kindLabel,
  runningTasks,
  statusLabel,
  type BackgroundTask,
} from "@/lib/background-tasks"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"
import { useServer } from "@/lib/server-context"

/** Token totals are only worth fetching for a handful of runs at a time. */
const STATS_CONCURRENCY = 4

/** The agent glyph: a square stood on its corner, matching the transcript marker. */
function AgentGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 15,
        height: 15,
        borderWidth: 1.6,
        borderColor: color,
        borderRadius: 2,
        transform: [{ rotate: "45deg" }],
      }}
    />
  )
}

function MetaText({ children }: { children: ReactNode }) {
  const { palette } = useAppTheme()
  return (
    <Text style={{ color: palette.muted, ...typeStyle(13) }} numberOfLines={1}>
      {children}
    </Text>
  )
}

type BackgroundTaskCardProps = {
  task: BackgroundTask
  now: number
  tokens?: number
  onStop?(task: BackgroundTask): void
  onOpenTranscript(task: BackgroundTask): void
}

function BackgroundTaskCard({ task, now, tokens, onStop, onOpenTranscript }: BackgroundTaskCardProps) {
  const { palette, isDark } = useAppTheme()
  const running = task.status === "running"
  const duration = durationLabel(task, now)

  return (
    <View
      style={{
        borderRadius: 18,
        borderCurve: "continuous",
        backgroundColor: isDark ? hexToRgba(palette.ink, 0.06) : hexToRgba(palette.ink, 0.04),
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ width: 20, alignItems: "center", paddingTop: 2 }}>
          {task.kind === "agent" ? (
            <AgentGlyph color={running ? palette.muted : palette.ink} />
          ) : (
            <SquareTerminal size={18} color={running ? palette.muted : palette.ink} strokeWidth={2} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text
            numberOfLines={2}
            style={{
              // A running title stays quiet until it settles, so the eye lands on
              // what has finished rather than on what is still moving.
              color: running ? palette.muted : palette.ink,
              ...typeStyle(17, { weight: "600" }),
            }}
          >
            {task.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <Text style={{ color: palette.ink, ...typeStyle(13, { weight: "500" }) }}>{kindLabel(task)}</Text>
            {running ? null : <MetaText>{statusLabel(task.status)}</MetaText>}
            {duration ? <MetaText>{duration}</MetaText> : null}
            {tokens ? <MetaText>{`${formatTokenCount(tokens)} tokens`}</MetaText> : null}
            {task.toolUses ? (
              <MetaText>{`${task.toolUses} ${task.toolUses === 1 ? "tool use" : "tool uses"}`}</MetaText>
            ) : null}
            {task.childSessionID ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`View transcript for ${task.title}`}
                onPress={() => {
                  void triggerHaptic("selection")
                  onOpenTranscript(task)
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ color: palette.accentLight, ...typeStyle(13, { weight: "500" }) }}>View transcript</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {running && onStop && task.childSessionID ? (
          <IconCircleButton
            size={34}
            accessibilityLabel={`Stop ${task.title}`}
            onPress={() => {
              void triggerHaptic("permission")
              onStop(task)
            }}
          >
            <Square size={13} color={palette.ink} strokeWidth={2.4} fill={palette.ink} />
          </IconCircleButton>
        ) : null}
      </View>
      {task.command ? (
        <Text
          numberOfLines={1}
          style={{ color: palette.muted, marginLeft: 32, fontFamily: "Menlo", fontSize: 12, lineHeight: 17 }}
        >
          {task.command}
        </Text>
      ) : null}
    </View>
  )
}

/**
 * Token totals per background run.
 *
 * A sub-agent's usage lives in its own session, so it is only fetched while the
 * sheet is open, once per child session, a few at a time.
 */
function useTaskTokens(tasks: BackgroundTask[], enabled: boolean) {
  const { client } = useServer()
  const [tokens, setTokens] = useState<Record<string, number>>({})
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    if (!enabled || !client) return
    const pending = tasks
      .map((task) => task.childSessionID)
      .filter((id): id is string => Boolean(id) && !inFlight.current.has(id as string))
      .slice(0, STATS_CONCURRENCY)
    if (pending.length === 0) return

    let cancelled = false
    for (const id of pending) inFlight.current.add(id)

    void Promise.all(
      pending.map(async (id) => {
        try {
          const detail = await client.getSession(id)
          const total = detail.messages.reduce((sum, message) => {
            if (message.info.role !== "assistant") return sum
            const usage = message.info.tokens
            return sum + usage.input + usage.output + usage.reasoning + usage.cache.read + usage.cache.write
          }, 0)
          return [id, total] as const
        } catch {
          // A sub-session that has been pruned simply has no token line.
          return [id, 0] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      setTokens((current) => {
        const next = { ...current }
        for (const [id, total] of entries) if (total > 0) next[id] = total
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [client, enabled, tasks])

  return tokens
}

type BackgroundActivitySheetProps = {
  visible: boolean
  tasks: BackgroundTask[]
  onClose(): void
  onStop?(task: BackgroundTask): void
  onOpenTranscript(task: BackgroundTask): void
}

/**
 * Everything the session is running away from the transcript: sub-agents and
 * detached shell commands, grouped by whether they are still going.
 */
export function BackgroundActivitySheet({
  visible,
  tasks,
  onClose,
  onStop,
  onOpenTranscript,
}: BackgroundActivitySheetProps) {
  const { palette } = useAppTheme()
  const { height } = useWindowDimensions()
  const scrollProps = useSheetScrollProps()
  const [now, setNow] = useState(() => Date.now())

  const running = useMemo(() => runningTasks(tasks), [tasks])
  const finished = useMemo(() => finishedTasks(tasks), [tasks])
  const tokens = useTaskTokens(finished, visible)

  // Elapsed times only tick while someone is watching them.
  useEffect(() => {
    if (!visible || running.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running.length, visible])

  const openTranscript = useCallback(
    (task: BackgroundTask) => {
      onClose()
      onOpenTranscript(task)
    },
    [onClose, onOpenTranscript],
  )

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      height={Math.min(height * 0.92, height - 48)}
      accessibilityLabel="Background activity"
    >
      <View style={{ flex: 1 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingBottom: 14,
          }}
        >
          <IconCircleButton size={44} accessibilityLabel="Close background activity" onPress={onClose}>
            <X size={20} color={palette.ink} strokeWidth={2.2} />
          </IconCircleButton>
          <Text style={{ flex: 1, textAlign: "center", color: palette.ink, ...typeStyle(20, { weight: "700" }) }}>
            Background activity
          </Text>
          {/* Balances the close button so the title stays optically centred. */}
          <View style={{ width: 44 }} />
        </View>

        <ScrollView
          {...scrollProps}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {tasks.length === 0 ? (
            <EmptyState
              title="Nothing in the background"
              description="Sub-agents and detached shell commands show up here while they run, with their transcripts."
            />
          ) : null}

          {running.length > 0 ? (
            <CollapsibleSection
              label="Running"
              accessory={<ActivityIndicator size="small" color={palette.muted} />}
            >
              {running.map((task) => (
                <BackgroundTaskCard
                  key={task.id}
                  task={task}
                  now={now}
                  onStop={onStop}
                  onOpenTranscript={openTranscript}
                />
              ))}
            </CollapsibleSection>
          ) : null}

          {finished.length > 0 ? (
            <CollapsibleSection label="Completed" count={finished.length}>
              {finished.map((task) => (
                <BackgroundTaskCard
                  key={task.id}
                  task={task}
                  now={now}
                  tokens={task.childSessionID ? tokens[task.childSessionID] : undefined}
                  onOpenTranscript={openTranscript}
                />
              ))}
            </CollapsibleSection>
          ) : null}
        </ScrollView>
      </View>
    </SheetShell>
  )
}
