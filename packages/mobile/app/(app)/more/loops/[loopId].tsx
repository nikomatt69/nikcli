import { useCallback, useState } from "react"
import { Alert, Pressable, ScrollView, Text, View } from "react-native"
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-context"
import type {
  LoopDefinition,
  LoopRun,
  LoopRuntime,
  LoopStage,
  LoopTemplate,
  LoopTrigger,
  LoopWriteInput,
} from "@/lib/types"
import { relativeTime } from "@/lib/types"

type StageDraft = {
  name: string
  agent: string
  model: string
  objective: string
  tokenBudget: string
}

const EMPTY_STAGE: StageDraft = {
  name: "work",
  agent: "ralph",
  model: "",
  objective: "",
  tokenBudget: "",
}

function stageDraft(stage?: Partial<LoopStage>): StageDraft {
  return {
    name: stage?.name ?? "work",
    agent: stage?.agent ?? "ralph",
    model: stage?.model ?? "",
    objective: stage?.objective ?? "",
    tokenBudget: stage?.tokenBudget ? String(stage.tokenBudget) : "",
  }
}

function parseDuration(value: string): number {
  const text = value.trim().toLowerCase()
  if (!text) throw new Error("Schedule is empty")
  if (/^\d+$/.test(text)) return Number(text) * 60_000
  const matcher = /(\d+)\s*([dhms])/g
  const unit = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 } as const
  let total = 0
  let consumed = ""
  for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
    total += Number(match[1]) * unit[match[2] as keyof typeof unit]
    consumed += match[0]
  }
  if (total <= 0 || consumed.replace(/\s/g, "") !== text.replace(/\s/g, "")) {
    throw new Error("Use a duration such as 30s, 10m, 1h, or 1h30m.")
  }
  return total
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.round((ms % 3_600_000) / 60_000)
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
}

function triggerText(trigger: LoopTrigger): string {
  return trigger.kind === "interval" ? formatDuration(trigger.everyMs) : ""
}

function runtimeTone(runtime?: LoopRuntime): "neutral" | "accent" | "good" | "warn" {
  if (!runtime) return "neutral"
  if (runtime.status === "running" || runtime.status === "cancelling") return "accent"
  if (runtime.status === "error" || runtime.status === "paused") return "warn"
  return "good"
}

export default function LoopDetailScreen() {
  const { loopId } = useLocalSearchParams<{ loopId: string }>()
  const isNew = loopId === "new"
  const { client } = useServer()

  const [definition, setDefinition] = useState<LoopDefinition | null>(null)
  const [runtime, setRuntime] = useState<LoopRuntime | null>(null)
  const [runs, setRuns] = useState<LoopRun[]>([])
  const [templates, setTemplates] = useState<LoopTemplate[]>([])
  const [name, setName] = useState("")
  const [stages, setStages] = useState<StageDraft[]>([{ ...EMPTY_STAGE }])
  const [schedule, setSchedule] = useState("")
  const [maxRuns, setMaxRuns] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [generateDescription, setGenerateDescription] = useState("")
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const applyDefinition = useCallback(
    (loop: LoopDefinition) => {
      setDefinition(loop)
      // Only overwrite the form drafts when the user does NOT have unsaved
      // changes. Otherwise a 5s poll would silently wipe whatever they were
      // typing. The dirty flag is reset by `save` and by explicit load() with
      // a confirmed-clean draft.
      setName((current) => (dirty ? current : loop.name))
      setStages((current) => (dirty ? current : loop.stages.map((stage) => stageDraft(stage))))
      setSchedule((current) => (dirty ? current : triggerText(loop.trigger)))
      setMaxRuns((current) => (dirty ? current : loop.maxRuns ? String(loop.maxRuns) : ""))
      setEnabled((current) => (dirty ? current : loop.enabled))
    },
    [dirty],
  )

  const setDraftField: typeof setName = useCallback((value) => {
    setName(value)
    setDirty(true)
  }, [])

  // Same for stages/schedule/maxRuns/enabled would each need their wrapper;
  // The React state setter-identity is what matters: any call from a TextField
  // onChange must toggle dirty. Wrap each setter used in a control.
  const setStagesDraft: typeof setStages = useCallback((updater) => {
    setStages(updater)
    setDirty(true)
  }, [])
  const setScheduleDraft: typeof setSchedule = useCallback((value) => {
    setSchedule(value)
    setDirty(true)
  }, [])
  const setMaxRunsDraft: typeof setMaxRuns = useCallback((value) => {
    setMaxRuns(value)
    setDirty(true)
  }, [])
  const setEnabledDraft: typeof setEnabled = useCallback((value) => {
    setEnabled(value)
    setDirty(true)
  }, [])

  const load = useCallback(
    async (silent = false) => {
      if (!client) return
      try {
        if (!silent) setLoading(true)
        setError(null)
        const templatesPromise = client.listLoopTemplates()
        if (isNew || !loopId) {
          setTemplates((await templatesPromise).templates)
          return
        }
        const [detail, history, templateResult] = await Promise.all([
          client.getLoop(loopId),
          client.listLoopRuns(loopId),
          templatesPromise,
        ])
        applyDefinition(detail.loop)
        setRuntime(detail.runtime)
        setRuns(history.runs)
        setTemplates(templateResult.templates)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [applyDefinition, client, isNew, loopId],
  )

  // Lightweight poll: refreshes runtime + runs + templates only, leaving any
  // unsaved form edits alone. This replaces the old full-load polling that
  // overwrote draft fields every 5s.
  const pollRuntime = useCallback(async () => {
    if (!client || isNew || !loopId) return
    try {
      const [detail, history] = await Promise.all([client.getLoop(loopId), client.listLoopRuns(loopId)])
      // `definition` is server-authoritative metadata (id, name, etc) and is
      // safe to refresh, but the form drafts are unchanged.
      setDefinition(detail.loop)
      setRuntime(detail.runtime)
      setRuns(history.runs)
    } catch {
      // Silent — polls are best-effort; the form-bound error is set by `load`.
    }
  }, [client, isNew, loopId])

  useFocusEffect(
    useCallback(() => {
      void load()
      if (isNew) return
      const interval = setInterval(() => void pollRuntime(), 5_000)
      return () => clearInterval(interval)
    }, [isNew, load, pollRuntime]),
  )

  function updateStage(index: number, patch: Partial<StageDraft>) {
    setStages((current) => current.map((stage, stageIndex) => (stageIndex === index ? { ...stage, ...patch } : stage)))
    setDirty(true)
  }

  function removeStage(index: number) {
    setStages((current) => current.filter((_, stageIndex) => stageIndex !== index))
    setDirty(true)
  }

  function moveStage(index: number, direction: -1 | 1) {
    setStages((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setDirty(true)
  }

  function applyTemplate(template: LoopTemplate) {
    setName(template.draft.name ?? template.title)
    setStages(
      template.draft.stages.map((stage, index) =>
        stageDraft({
          name: stage.name ?? `stage ${index + 1}`,
          agent: stage.agent ?? "ralph",
          model: stage.model,
          objective: stage.objective,
          tokenBudget: stage.tokenBudget,
        }),
      ),
    )
    setSchedule(template.draft.intervalMs ? formatDuration(template.draft.intervalMs) : "")
    setMaxRuns(template.draft.maxRuns ? String(template.draft.maxRuns) : "")
    setEnabled(true)
    setDirty(true)
  }

  function buildInput(): LoopWriteInput {
    if (!name.trim()) throw new Error("Loop name is required.")
    if (stages.length === 0) throw new Error("Add at least one stage.")

    const normalizedStages: LoopStage[] = stages.map((stage, index) => {
      if (!stage.name.trim()) throw new Error(`Stage ${index + 1} needs a name.`)
      if (!stage.agent.trim()) throw new Error(`Stage ${index + 1} needs an agent.`)
      if (!stage.objective.trim()) throw new Error(`Stage ${index + 1} needs an objective.`)
      if (stage.model.trim() && !/^[^/]+\/[^/]+$/.test(stage.model.trim())) {
        throw new Error(`Stage ${index + 1} model must use provider/model format.`)
      }
      const budget = stage.tokenBudget.trim() ? Number(stage.tokenBudget) : undefined
      if (budget !== undefined && (!Number.isInteger(budget) || budget <= 0)) {
        throw new Error(`Stage ${index + 1} token budget must be a positive integer.`)
      }
      return {
        name: stage.name.trim(),
        agent: stage.agent.trim(),
        objective: stage.objective.trim(),
        ...(stage.model.trim() ? { model: stage.model.trim() } : {}),
        ...(budget !== undefined ? { tokenBudget: budget } : {}),
      }
    })

    const everyMs = schedule.trim() ? parseDuration(schedule) : undefined
    if (everyMs !== undefined && everyMs < 30_000) throw new Error("Loop interval must be at least 30s.")
    const runCap = maxRuns.trim() ? Number(maxRuns) : undefined
    if (runCap !== undefined && (!Number.isInteger(runCap) || runCap <= 0)) {
      throw new Error("Max runs must be a positive integer.")
    }

    return {
      name: name.trim(),
      stages: normalizedStages,
      trigger: everyMs !== undefined ? { kind: "interval", everyMs } : { kind: "manual" },
      ...(runCap !== undefined ? { maxRuns: runCap } : {}),
      enabled,
    }
  }

  async function save() {
    if (!client) return
    try {
      setSaving(true)
      setError(null)
      const input = buildInput()
      if (isNew) {
        const created = await client.createLoop(input)
        setDirty(false)
        router.replace(`/more/loops/${created.id}` as Href)
      } else if (loopId) {
        const updated = await client.updateLoop(loopId, input)
        setDirty(false)
        applyDefinition(updated)
        await load(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  async function runAction(label: string, operation: () => Promise<unknown>) {
    try {
      setAction(label)
      setError(null)
      await operation()
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAction(null)
    }
  }

  async function generate() {
    if (!client || !generateDescription.trim()) {
      setError("Describe the loop you want to generate.")
      return
    }
    await runAction("generate", async () => {
      const generated = await client.generateLoop(generateDescription.trim())
      applyDefinition(generated)
    })
  }

  function deleteLoop() {
    if (!client || !definition) return
    Alert.alert("Delete loop", `Delete "${definition.name}" and its run history?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              setAction("delete")
              setError(null)
              await client.deleteLoop(definition.id)
              router.replace("/more/loops" as Href)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            } finally {
              setAction(null)
            }
          })()
        },
      },
    ])
  }

  if (loading) {
    return (
      <View className="flex-1 bg-background px-4 pt-4">
        <SurfaceCard eyebrow="Loading" title="Fetching loop…" description="" />
      </View>
    )
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
    >
      <ActionButton label="Back to loops" onPress={() => router.replace("/more/loops" as Href)} variant="secondary" />
      {error ? <ErrorBanner message={error} /> : null}

      {!isNew && definition && runtime ? (
        <SurfaceCard
          eyebrow="Runtime"
          title={definition.name}
          description={runtime.lastError ?? "Control the current run and interval schedule."}
        >
          <View className="flex-row flex-wrap gap-2">
            <InfoChip label={runtime.status} tone={runtimeTone(runtime)} />
            <InfoChip
              label={definition.enabled ? "Enabled" : "Disabled"}
              tone={definition.enabled ? "good" : "neutral"}
            />
            <InfoChip label={`${runtime.runs} runs`} tone="neutral" />
            {runtime.lastRunAt ? <InfoChip label={`Last ${relativeTime(runtime.lastRunAt)}`} tone="neutral" /> : null}
          </View>
          <View className="mt-4 gap-3">
            {runtime.status === "running" || runtime.status === "cancelling" ? (
              <ActionButton
                label="Abort current run"
                loading={action === "abort"}
                onPress={() => void runAction("abort", () => client!.abortLoop(definition.id))}
                variant="danger"
              />
            ) : (
              <ActionButton
                label="Run now"
                loading={action === "run"}
                disabled={!definition.enabled || runtime.status === "paused"}
                onPress={() => void runAction("run", () => client!.runLoop(definition.id))}
              />
            )}
            {definition.trigger.kind === "interval" ? (
              <ActionButton
                label={runtime.status === "paused" ? "Resume schedule" : "Pause schedule"}
                loading={action === "schedule"}
                onPress={() =>
                  void runAction("schedule", () =>
                    runtime.status === "paused" ? client!.resumeLoop(definition.id) : client!.pauseLoop(definition.id),
                  )
                }
                variant="secondary"
              />
            ) : null}
            <ActionButton
              label={definition.enabled ? "Disable loop" : "Enable loop"}
              loading={action === "toggle"}
              onPress={() => void runAction("toggle", () => client!.toggleLoop(definition.id, !definition.enabled))}
              variant="secondary"
            />
            {runtime.sessionID ? (
              <ActionButton
                label="Open current session"
                onPress={() => router.push(`/sessions/${runtime.sessionID}` as Href)}
                variant="secondary"
              />
            ) : null}
          </View>
        </SurfaceCard>
      ) : null}

      {isNew ? (
        <>
          <SurfaceCard
            eyebrow="Start faster"
            title="Templates"
            description="Apply a starter and edit its stages before creating the loop."
          >
            <View className="gap-3">
              {templates.map((template) => (
                <Pressable key={template.id} onPress={() => applyTemplate(template)}>
                  <SurfaceCard title={template.title} description={template.description} tone="panel">
                    <InfoChip label={`${template.draft.stages.length} stages`} tone="neutral" />
                  </SurfaceCard>
                </Pressable>
              ))}
            </View>
          </SurfaceCard>
          <SurfaceCard
            eyebrow="Generate"
            title="Describe a loop"
            description="Ask the configured agent to draft the loop, then review every field before saving."
          >
            <View className="gap-3">
              <TextField
                label="Description"
                value={generateDescription}
                onChangeText={setGenerateDescription}
                placeholder="Keep tests green every hour and fix failures"
                multiline
              />
              <ActionButton
                label="Generate draft"
                loading={action === "generate"}
                onPress={() => void generate()}
                variant="secondary"
              />
            </View>
          </SurfaceCard>
        </>
      ) : null}

      <SurfaceCard
        eyebrow={isNew ? "New loop" : `ID: ${loopId}`}
        title={isNew ? "Create loop" : "Edit definition"}
        description="A loop runs its stages in order inside one goal-driven session."
      >
        <View className="gap-3">
          <TextField label="Name" value={name} onChangeText={setDraftField} placeholder="Keep tests green" />
          <TextField
            label="Interval"
            value={schedule}
            onChangeText={setScheduleDraft}
            placeholder="Leave empty for manual, or use 10m / 1h"
            autoCapitalize="none"
          />
          <TextField
            label="Max runs"
            value={maxRuns}
            onChangeText={setMaxRunsDraft}
            placeholder="Unlimited"
            keyboardType="number-pad"
          />
          <Pressable onPress={() => setEnabledDraft((value) => !value)}>
            <InfoChip label={enabled ? "Enabled on save" : "Disabled on save"} tone={enabled ? "good" : "neutral"} />
          </Pressable>
        </View>
      </SurfaceCard>

      <View className="gap-3">
        {stages.map((stage, index) => (
          <SurfaceCard
            key={index}
            eyebrow={`Stage ${index + 1}`}
            title={stage.name.trim() || "Untitled stage"}
            description="Each stage runs the goal command and must complete before the next stage starts."
          >
            <View className="gap-3">
              <TextField
                label="Name"
                value={stage.name}
                onChangeText={(value) => updateStage(index, { name: value })}
              />
              <TextField
                label="Objective"
                value={stage.objective}
                onChangeText={(value) => updateStage(index, { objective: value })}
                placeholder="Describe the verifiable outcome for this stage"
                multiline
              />
              <TextField
                label="Agent"
                value={stage.agent}
                onChangeText={(value) => updateStage(index, { agent: value })}
                placeholder="ralph"
                autoCapitalize="none"
              />
              <TextField
                label="Model override"
                value={stage.model}
                onChangeText={(value) => updateStage(index, { model: value })}
                placeholder="provider/model (optional)"
                autoCapitalize="none"
              />
              <TextField
                label="Token budget"
                value={stage.tokenBudget}
                onChangeText={(value) => updateStage(index, { tokenBudget: value })}
                placeholder="Optional"
                keyboardType="number-pad"
              />
              <View className="flex-row flex-wrap gap-2">
                <Pressable onPress={() => moveStage(index, -1)} disabled={index === 0}>
                  <InfoChip label="Move up" tone="neutral" />
                </Pressable>
                <Pressable onPress={() => moveStage(index, 1)} disabled={index === stages.length - 1}>
                  <InfoChip label="Move down" tone="neutral" />
                </Pressable>
                {stages.length > 1 ? (
                  <Pressable onPress={() => removeStage(index)}>
                    <InfoChip label="Remove" tone="warn" />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </SurfaceCard>
        ))}
        <ActionButton
          label="Add stage"
          onPress={() => {
            setStages((current) => [...current, stageDraft({ name: `stage ${current.length + 1}` })])
            setDirty(true)
          }}
          variant="secondary"
        />
      </View>

      <View className="gap-3">
        <ActionButton label={isNew ? "Create loop" : "Save changes"} loading={saving} onPress={() => void save()} />
        {!isNew && definition ? (
          <ActionButton label="Delete loop" loading={action === "delete"} onPress={deleteLoop} variant="danger" />
        ) : null}
      </View>

      {!isNew && runs.length > 0 ? (
        <SurfaceCard eyebrow="History" title="Recent runs" description="Inspect the session created by each loop run.">
          <View className="gap-3">
            {runs.map((run) => (
              <SurfaceCard
                key={run.id}
                eyebrow={relativeTime(run.startedAt)}
                title={run.status}
                description={run.error ?? (run.ok ? "Run completed successfully." : "Run did not complete.")}
                tone="panel"
              >
                <View className="flex-row flex-wrap gap-2">
                  <InfoChip label={run.ok ? "Success" : run.status} tone={run.ok ? "good" : "warn"} />
                  {run.endedAt ? <InfoChip label={`Ended ${relativeTime(run.endedAt)}`} tone="neutral" /> : null}
                </View>
                {run.sessionID ? (
                  <View className="mt-3">
                    <ActionButton
                      label="Open session"
                      onPress={() => router.push(`/sessions/${run.sessionID}` as Href)}
                      variant="secondary"
                    />
                  </View>
                ) : null}
              </SurfaceCard>
            ))}
          </View>
        </SurfaceCard>
      ) : null}

      <Text className="text-center text-xs text-muted">
        Loop intervals keep running on the connected nikcli server, even when this screen is closed.
      </Text>
    </ScrollView>
  )
}
