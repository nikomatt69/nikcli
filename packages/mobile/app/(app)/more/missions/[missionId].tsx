import { useCallback, useState } from "react"
import { Alert, Pressable, ScrollView, Text, View } from "react-native"
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-context"
import { triggerHaptic } from "@/lib/haptics"
import type {
  MissionDefinition,
  MissionExec,
  MissionFeature,
  MissionMilestone,
  MissionRuntime,
  MissionTemplate,
  MissionWriteInput,
} from "@/lib/types"
import { relativeTime } from "@/lib/types"

function blankMission(name: string, brief: string): MissionWriteInput {
  return {
    name: name.trim() || "Untitled mission",
    brief: brief.trim() || "Complete the requested work end-to-end.",
    milestones: [
      {
        id: "m1",
        name: "First milestone",
        validation: "scrutiny",
        status: "pending",
        features: [
          {
            id: "f1_1",
            name: "First feature",
            objective: brief.trim() || "Implement the requested work",
            agent: "ralph",
            dependsOn: [],
            status: "pending",
          },
        ],
      },
    ],
    models: {},
    sandbox: true,
  }
}

function featureTone(status: MissionFeature["status"]): "neutral" | "accent" | "good" | "warn" {
  if (status === "running") return "accent"
  if (status === "done") return "good"
  if (status === "error" || status === "blocked") return "warn"
  return "neutral"
}

export default function MissionDetailScreen() {
  const { missionId } = useLocalSearchParams<{ missionId: string }>()
  const isNew = missionId === "new"
  const { client } = useServer()

  const [definition, setDefinition] = useState<MissionDefinition | null>(null)
  const [runtime, setRuntime] = useState<MissionRuntime | null>(null)
  const [execs, setExecs] = useState<MissionExec[]>([])
  const [templates, setTemplates] = useState<MissionTemplate[]>([])
  const [name, setName] = useState("")
  const [brief, setBrief] = useState("")
  const [generateDescription, setGenerateDescription] = useState("")
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!client) return
      try {
        if (!silent) setLoading(true)
        setError(null)
        const templatesPromise = client.listMissionTemplates()
        if (isNew || !missionId) {
          setTemplates((await templatesPromise).templates)
          return
        }
        const [detail, history, templateResult] = await Promise.all([
          client.getMission(missionId),
          client.listMissionExecs(missionId),
          templatesPromise,
        ])
        setDefinition(detail.mission)
        setRuntime(detail.runtime)
        setName(detail.mission.name)
        setBrief(detail.mission.brief)
        setExecs(history.execs)
        setTemplates(templateResult.templates)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [client, isNew, missionId],
  )

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function save() {
    if (!client) return
    try {
      setSaving(true)
      setError(null)
      if (isNew) {
        const saved = await client.createMission(blankMission(name, brief))
        void triggerHaptic("success")
        router.replace(`/more/missions/${saved.id}` as Href)
        return
      }
      if (!definition) return
      await client.updateMission(definition.id, { ...definition, name: name.trim(), brief: brief.trim() })
      void triggerHaptic("success")
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      void triggerHaptic("error")
    } finally {
      setSaving(false)
    }
  }

  async function generate() {
    if (!client || !generateDescription.trim()) return
    try {
      setAction("generate")
      setError(null)
      const generated = await client.generateMission(generateDescription.trim())
      const saved = await client.createMission({
        name: generated.name,
        brief: generated.brief,
        milestones: generated.milestones,
        models: generated.models,
        timeoutMs: generated.timeoutMs,
        sandbox: generated.sandbox,
      })
      void triggerHaptic("success")
      router.replace(`/more/missions/${saved.id}` as Href)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      void triggerHaptic("error")
    } finally {
      setAction(null)
    }
  }

  async function useTemplate(template: MissionTemplate) {
    setName(template.title)
    setBrief(template.brief)
  }

  async function run(kind: "start" | "pause" | "cancel") {
    if (!client || !definition) return
    try {
      setAction(kind)
      setError(null)
      if (kind === "start") await client.startMission(definition.id)
      else if (kind === "pause") await client.pauseMission(definition.id)
      else await client.cancelMission(definition.id)
      void triggerHaptic(kind === "cancel" ? "error" : "success")
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAction(null)
    }
  }

  async function markFeature(feature: MissionFeature, status: MissionFeature["status"]) {
    if (!client || !definition) return
    try {
      setAction(feature.id)
      await client.mutateMissionFeature(definition.id, feature.id, { status })
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAction(null)
    }
  }

  function remove() {
    if (!client || !definition) return
    Alert.alert("Delete mission", "This removes the mission definition. Running work is cancelled first.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await client.deleteMission(definition.id)
              router.back()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          })()
        },
      },
    ])
  }

  return (
    <ScrollView
      className="flex-1 bg-background px-4 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 36, gap: 16 }}
    >
      {error ? <ErrorBanner message={error} /> : null}

      <SurfaceCard eyebrow={isNew ? "Create" : "Plan"} title={isNew ? "New mission" : (definition?.name ?? "Mission")}>
        <View className="gap-3">
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Ship the checkout flow" />
          <TextField
            label="Brief"
            value={brief}
            onChangeText={setBrief}
            placeholder="What should this mission accomplish?"
            multiline
          />
          <ActionButton label={isNew ? "Create" : "Save"} loading={saving || loading} onPress={() => void save()} />
        </View>
      </SurfaceCard>

      {isNew ? (
        <SurfaceCard
          eyebrow="Generate"
          title="From a description"
          description="The host plans milestones and features."
        >
          <View className="gap-3">
            <TextField
              label="Description"
              value={generateDescription}
              onChangeText={setGenerateDescription}
              placeholder="Migrate auth to sessions, keep tests green."
              multiline
            />
            <ActionButton
              label="Generate mission"
              loading={action === "generate"}
              disabled={!generateDescription.trim()}
              onPress={() => void generate()}
            />
            {templates.map((template) => (
              <Pressable key={template.id} onPress={() => void useTemplate(template)}>
                <Text className="text-[13px] font-semibold text-ink">{template.title}</Text>
                <Text className="mt-1 text-[12px] leading-[17px] text-soft">{template.description}</Text>
              </Pressable>
            ))}
          </View>
        </SurfaceCard>
      ) : null}

      {runtime ? (
        <SurfaceCard eyebrow="Runtime" title={runtime.status}>
          <View className="flex-row flex-wrap gap-2">
            <InfoChip
              label={`${runtime.doneFeatures}/${runtime.totalFeatures} features`}
              tone={runtime.status === "running" ? "accent" : "neutral"}
            />
            {runtime.lastError ? <InfoChip label={runtime.lastError} tone="warn" /> : null}
          </View>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <ActionButton label="Start" loading={action === "start"} onPress={() => void run("start")} />
            <ActionButton
              label="Pause"
              variant="secondary"
              loading={action === "pause"}
              onPress={() => void run("pause")}
            />
            <ActionButton
              label="Cancel"
              variant="danger"
              loading={action === "cancel"}
              onPress={() => void run("cancel")}
            />
          </View>
          {runtime.sessionID ? (
            <View className="mt-3">
              <ActionButton
                label="Open session"
                variant="secondary"
                onPress={() => router.push(`/sessions/${runtime.sessionID}` as Href)}
              />
            </View>
          ) : null}
        </SurfaceCard>
      ) : null}

      {definition?.milestones.map((milestone: MissionMilestone) => (
        <SurfaceCard key={milestone.id} eyebrow={milestone.validation} title={milestone.name}>
          <View className="gap-3">
            {milestone.features.map((feature) => (
              <View key={feature.id} className="gap-2">
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="flex-1 text-[14px] font-semibold text-ink">{feature.name}</Text>
                  <InfoChip label={feature.status} tone={featureTone(feature.status)} />
                </View>
                <Text className="text-[13px] leading-[18px] text-soft">{feature.objective}</Text>
                <View className="flex-row gap-2">
                  <ActionButton
                    label="Skip"
                    variant="ghost"
                    loading={action === feature.id}
                    onPress={() => void markFeature(feature, "skipped")}
                  />
                  <ActionButton
                    label="Done"
                    variant="secondary"
                    loading={action === feature.id}
                    onPress={() => void markFeature(feature, "done")}
                  />
                </View>
              </View>
            ))}
          </View>
        </SurfaceCard>
      ))}

      {execs.length ? (
        <SurfaceCard eyebrow="History" title={`${execs.length} runs`}>
          <View className="gap-3">
            {execs.map((exec) => (
              <Pressable
                key={exec.id}
                disabled={!exec.sessionID}
                onPress={() => exec.sessionID && router.push(`/sessions/${exec.sessionID}` as Href)}
              >
                <Text className="text-[14px] font-semibold text-ink">{exec.targetName}</Text>
                <Text className="mt-1 text-[12px] text-soft">
                  {exec.kind} · {exec.status} · {relativeTime(exec.startedAt)}
                </Text>
              </Pressable>
            ))}
          </View>
        </SurfaceCard>
      ) : null}

      {!isNew ? <ActionButton label="Delete mission" variant="danger" onPress={remove} /> : null}
    </ScrollView>
  )
}
