import { useCallback, useMemo, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-context"
import { type SkillInfo } from "@/lib/types"

export default function SkillsSettingsScreen() {
  const { client } = useServer()
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setSkills(await client.listSkills())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const visibleSkills = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return skills
    return skills.filter((skill) =>
      [skill.name, skill.description, skill.category ?? "", ...(skill.tags ?? [])].some((value) =>
        value.toLowerCase().includes(term),
      ),
    )
  }, [search, skills])

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "Skills" }} />

      <SurfaceCard
        eyebrow="Skill registry"
        title="Host-discovered skill catalog"
        description="Browse skills already exposed by the host, inspect provenance, and understand what automation knowledge is available right now."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${skills.length} skills`} tone={skills.length ? "accent" : "neutral"} />
          <InfoChip label="Sources: .nikcli / .claude / .agents" />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      <SurfaceCard
        eyebrow="Search"
        title="Find a skill quickly"
        description="Filter by name, category, description, or tags to understand what the host can already do."
      >
        <View className="gap-3">
          <TextField
            label="Search skills"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            placeholder="Search skills, categories, tags"
          />
          {loading ? (
            <View className="rounded-[8px] border border-border bg-background/60 p-4">
              <Text className="text-sm leading-6 text-soft">Loading skill registry…</Text>
            </View>
          ) : (
            <View className="gap-3">
              {visibleSkills.length ? (
                visibleSkills.map((skill) => (
                  <View key={skill.name} className="rounded-[8px] border border-border bg-background/60 p-4">
                    <View className="flex-row flex-wrap gap-2">
                      <Text className="text-base font-semibold text-ink">{skill.name}</Text>
                      {skill.category ? <InfoChip label={skill.category} tone="accent" /> : null}
                      {skill.version ? <InfoChip label={`v${skill.version}`} /> : null}
                    </View>
                    <Text className="mt-2 text-sm leading-6 text-soft">{skill.description}</Text>
                    {skill.tags?.length ? (
                      <Text className="mt-2 text-xs leading-5 text-soft">Tags: {skill.tags.join(", ")}</Text>
                    ) : null}
                    <Text selectable className="mt-2 text-xs leading-5 text-soft">
                      {skill.location}
                    </Text>
                  </View>
                ))
              ) : (
                <View className="rounded-[8px] border border-border bg-background/60 p-4">
                  <Text className="text-sm leading-6 text-soft">
                    No skills matched this search or the host is not exposing any skill yet.
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </SurfaceCard>
    </ScrollView>
  )
}
