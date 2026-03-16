import { useCallback, useMemo, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import { type PromptHistoryEntry, type PromptStashEntry } from "@/lib/types"

export default function MemoriesSettingsScreen() {
  const { client } = useServer()
  const [history, setHistory] = useState<PromptHistoryEntry[]>([])
  const [stash, setStash] = useState<PromptStashEntry[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [snippetInput, setSnippetInput] = useState("")
  const [search, setSearch] = useState("")

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      const [nextHistory, nextStash] = await Promise.all([client.listPromptHistory(), client.listPromptStash()])
      setHistory(nextHistory)
      setStash(nextStash)
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

  async function addSnippet() {
    if (!client || !snippetInput.trim()) {
      setMessage("Snippet text is required")
      return
    }
    try {
      setSaving(true)
      setMessage(null)
      await client.addPromptStash({ input: snippetInput.trim() })
      setSnippetInput("")
      await load()
      setMessage("Saved reusable snippet to host memory")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function removeSnippet(id: string) {
    if (!client) return
    try {
      setSaving(true)
      setMessage(null)
      await client.removePromptStash(id)
      await load()
      setMessage("Removed saved snippet")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const visibleHistory = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return history
    return history.filter(
      (entry) => entry.input.toLowerCase().includes(term) || (entry.mode ?? "normal").toLowerCase().includes(term),
    )
  }, [history, search])

  const visibleStash = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return stash
    return stash.filter((entry) => entry.input.toLowerCase().includes(term))
  }, [search, stash])

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "Memories" }} />

      <SurfaceCard
        eyebrow="Memory surfaces"
        title="History, snippets, reusable context"
        description="Review recent prompt history from the host, keep reusable snippets, and turn repeated work into saved context for future sessions."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${history.length} recent prompts`} tone="accent" />
          <InfoChip label={`${stash.length} saved snippets`} />
          <InfoChip label="Host-backed memory" tone="good" />
        </View>
        <View className="mt-4">
          <TextField
            label="Search memories"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            placeholder="Search prompt history and saved snippets"
          />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      <SurfaceCard
        eyebrow="Saved snippets"
        title="Reusable prompt memory"
        description="Store high-value prompts and reusable instructions on the host so they can be surfaced again later."
      >
        <View className="gap-3">
          <TextField
            label="New snippet"
            value={snippetInput}
            onChangeText={setSnippetInput}
            multiline
            placeholder="Save a reusable instruction, checklist, or context block."
          />
          <ActionButton label="Save snippet" loading={saving} onPress={() => void addSnippet()} />

          <View className="gap-3">
            {visibleStash.length ? (
              visibleStash.map((entry) => (
                <View key={entry.id} className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
                  <View className="flex-row flex-wrap gap-2">
                    <InfoChip label={new Date(entry.timestamp).toLocaleDateString()} tone="accent" />
                    <InfoChip label={`${entry.partsCount} parts`} />
                  </View>
                  <Text selectable className="mt-2 text-sm leading-6 text-soft">
                    {entry.input}
                  </Text>
                  <View className="mt-3">
                    <ActionButton
                      label="Remove snippet"
                      variant="secondary"
                      disabled={saving}
                      onPress={() => void removeSnippet(entry.id)}
                    />
                  </View>
                </View>
              ))
            ) : (
              <View className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
                <Text className="text-sm leading-6 text-soft">No saved snippets matched this search yet.</Text>
              </View>
            )}
          </View>
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Recent prompt history"
        title="What you asked recently"
        description="This feed comes from the host prompt history file and helps reconstruct operator workflows across sessions."
      >
        {loading ? (
          <View className="items-center rounded-[22px] border border-border bg-background/60 px-4 py-5">
            <Text className="text-sm text-soft">Loading host prompt history…</Text>
          </View>
        ) : (
          <View className="gap-3">
            {visibleHistory.length ? (
              visibleHistory.map((entry) => (
                <View key={entry.id} className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
                  <View className="flex-row flex-wrap gap-2">
                    <InfoChip label={entry.mode || "normal"} tone="accent" />
                    <InfoChip label={`${entry.partsCount} parts`} />
                  </View>
                  <Text selectable className="mt-2 text-sm leading-6 text-soft">
                    {entry.input}
                  </Text>
                </View>
              ))
            ) : (
              <View className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
                <Text className="text-sm leading-6 text-soft">No prompt history matched this search yet.</Text>
              </View>
            )}
          </View>
        )}
      </SurfaceCard>
    </ScrollView>
  )
}
