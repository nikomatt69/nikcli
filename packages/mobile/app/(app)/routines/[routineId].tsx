import { useCallback, useEffect, useState } from "react"
import { Alert, Pressable, ScrollView, Text, View } from "react-native"
import { router, useLocalSearchParams, type Href } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-context"
import { useAppTheme } from "@/lib/theme"
import type { Routine, RoutineTrigger } from "@/lib/types"
import { relativeTime } from "@/lib/types"

const CRON_PRESETS = [
  { label: "@hourly", cron: "@hourly" },
  { label: "Every 6h", cron: "0 */6 * * *" },
  { label: "@daily", cron: "@daily" },
  { label: "@weekly", cron: "@weekly" },
]

export default function RoutineDetailScreen() {
  const { routineId } = useLocalSearchParams<{ routineId: string }>()
  const isNew = routineId === "new"
  const { client } = useServer()

  const [routine, setRoutine] = useState<Routine | null>(null)
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [triggers, setTriggers] = useState<RoutineTrigger[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSession, setLastSession] = useState<{ id: string } | null>(null)

  const load = useCallback(async () => {
    if (isNew || !client || !routineId) return
    try {
      setLoading(true)
      setError(null)
      const r = await client.getRoutine(routineId)
      setRoutine(r)
      setName(r.name)
      setPrompt(r.prompt)
      setTriggers(r.triggers)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [client, isNew, routineId])

  useEffect(() => {
    void load()
  }, [load])

  // ── Schedule trigger helpers ────────────────────────────────────────────────

  const scheduleTrigger = triggers.find((t) => t.type === "schedule") as
    | (RoutineTrigger & { type: "schedule"; cron: string })
    | undefined
  const apiTrigger = triggers.find((t) => t.type === "api") as
    | (RoutineTrigger & { type: "api"; token: string })
    | undefined

  function setScheduleCron(cron: string) {
    setTriggers((prev) => {
      const next: RoutineTrigger[] = prev.filter((t) => t.type !== "schedule")
      if (cron.trim()) next.push({ type: "schedule", cron: cron.trim(), enabled: true })
      return next
    })
  }

  function toggleSchedule(enabled: boolean) {
    setTriggers((prev) => prev.map((t) => (t.type === "schedule" ? { ...t, enabled } : t)))
  }

  function toggleApi(enabled: boolean) {
    setTriggers((prev) => prev.map((t) => (t.type === "api" ? { ...t, enabled } : t)))
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function save() {
    if (!client || !name.trim() || !prompt.trim()) {
      setError("Name and prompt are required.")
      return
    }
    try {
      setSaving(true)
      setError(null)
      if (isNew) {
        const created = await client.createRoutine({ name: name.trim(), prompt: prompt.trim(), triggers })
        router.replace(`/routines/${created.id}` as Href)
      } else if (routineId) {
        const updated = await client.updateRoutine(routineId, { name: name.trim(), prompt: prompt.trim(), triggers })
        setRoutine(updated)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function togglePause() {
    if (!client || !routine) return
    try {
      setSaving(true)
      setError(null)
      const updated = routine.paused ? await client.resumeRoutine(routine.id) : await client.pauseRoutine(routine.id)
      setRoutine(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    if (!client || !routine) return
    try {
      setRunning(true)
      setError(null)
      const session = await client.runRoutine(routine.id)
      setLastSession(session)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  async function deleteRoutine() {
    if (!client || !routine) return
    Alert.alert("Delete routine", `Delete "${routine.name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            setDeleting(true)
            await client.deleteRoutine(routine.id)
            router.replace("/routines" as Href)
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setDeleting(false)
          }
        },
      },
    ])
  }

  if (loading) {
    return (
      <View className="flex-1 bg-background px-4 pt-4">
        <SurfaceCard eyebrow="Loading" title="Fetching routine…" description="" />
      </View>
    )
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
      {error ? <ErrorBanner message={error} /> : null}

      {/* ── Basic info ──────────────────────────────────────────────────── */}
      <SurfaceCard
        eyebrow={isNew ? "New routine" : `ID: ${routineId}`}
        title={isNew ? "Create routine" : "Edit routine"}
        description="Give your routine a name and the prompt it will run."
      >
        {routine && !routine.paused ? (
          <View className="flex-row flex-wrap gap-2 mb-4">
            <InfoChip label="Active" tone="good" />
            {routine.lastRunAt ? (
              <InfoChip label={`Last run ${relativeTime(routine.lastRunAt)}`} tone="neutral" />
            ) : null}
          </View>
        ) : null}
        {routine?.paused ? (
          <View className="flex-row flex-wrap gap-2 mb-4">
            <InfoChip label="Paused" tone="warn" />
          </View>
        ) : null}
        <View className="gap-3">
          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Daily code review"
            autoCapitalize="none"
          />
          <TextField
            label="Prompt"
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Describe what the agent should do…"
            autoCapitalize="none"
          />
        </View>
      </SurfaceCard>

      {/* ── Schedule trigger ────────────────────────────────────────────── */}
      <SurfaceCard
        eyebrow="Schedule trigger"
        title="Run on a cron schedule"
        description="Pick a preset or enter a custom cron expression. Supports @hourly, @daily, */N (minutes), 0 */N * * * (hours)."
      >
        <View className="flex-row flex-wrap gap-2 mb-3">
          {CRON_PRESETS.map((p) => (
            <Pressable key={p.cron} onPress={() => setScheduleCron(p.cron)}>
              <InfoChip label={p.label} tone={scheduleTrigger?.cron === p.cron ? "accent" : "neutral"} />
            </Pressable>
          ))}
        </View>
        <TextField
          label="Cron expression"
          value={scheduleTrigger?.cron ?? ""}
          onChangeText={setScheduleCron}
          placeholder="@hourly"
          autoCapitalize="none"
        />
        {scheduleTrigger ? (
          <View className="mt-3 flex-row gap-3">
            <ActionButton
              label={scheduleTrigger.enabled ? "Disable schedule" : "Enable schedule"}
              onPress={() => toggleSchedule(!scheduleTrigger.enabled)}
              variant="secondary"
            />
          </View>
        ) : null}
      </SurfaceCard>

      {/* ── API trigger ─────────────────────────────────────────────────── */}
      {apiTrigger ? (
        <SurfaceCard
          eyebrow="API trigger"
          title="Trigger via HTTP POST"
          description={`POST /mobile/routines/trigger/${apiTrigger.token} — no bearer token required.`}
        >
          <View className="flex-row flex-wrap gap-2 mb-3">
            <InfoChip
              label={apiTrigger.enabled ? "Enabled" : "Disabled"}
              tone={apiTrigger.enabled ? "good" : "neutral"}
            />
          </View>
          <ActionButton
            label={apiTrigger.enabled ? "Disable API trigger" : "Enable API trigger"}
            onPress={() => toggleApi(!apiTrigger.enabled)}
            variant="secondary"
          />
        </SurfaceCard>
      ) : null}

      {/* ── Last session ────────────────────────────────────────────────── */}
      {lastSession || routine?.lastSessionID ? (
        <SurfaceCard eyebrow="Last run" title="Session created" description="">
          <View className="flex-row flex-wrap gap-2">
            <Pressable onPress={() => router.push(`/sessions/${lastSession?.id ?? routine?.lastSessionID}` as Href)}>
              <InfoChip label="View session" tone="accent" />
            </Pressable>
          </View>
        </SurfaceCard>
      ) : null}

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <View className="gap-3">
        <ActionButton label={isNew ? "Create routine" : "Save changes"} loading={saving} onPress={() => void save()} />
        {!isNew && routine ? (
          <>
            <ActionButton label="Run now" loading={running} onPress={() => void runNow()} variant="secondary" />
            <ActionButton
              label={routine.paused ? "Resume" : "Pause"}
              loading={saving}
              onPress={() => void togglePause()}
              variant="secondary"
            />
            <ActionButton
              label="Delete routine"
              loading={deleting}
              onPress={() => void deleteRoutine()}
              variant="ghost"
            />
          </>
        ) : null}
      </View>
    </ScrollView>
  )
}
