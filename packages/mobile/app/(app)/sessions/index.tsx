import { useCallback, useState } from "react"
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SessionListItem } from "@/components/SessionListItem"
import { useServer } from "@/lib/server-provider"
import type { SessionSummary } from "@/lib/types"

export default function SessionsScreen() {
  const { client, loading, config } = useServer()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setRefreshing(true)
      setError(null)
      setSessions(await client.listSessions())
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setRefreshing(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      if (!config) {
        router.replace("/")
        return
      }
      void load()
    }, [config, load]),
  )

  async function createSession() {
    if (!client || creating) return
    try {
      setCreating(true)
      setError(null)
      const session = await client.createSession({ title: "Mobile session" })
      router.push(`/sessions/${session.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fbbf24" />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.info.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor="#7dd3fc" />}
        ItemSeparatorComponent={() => <View className="h-3" />}
        renderItem={({ item }) => (
          <SessionListItem item={item} onPress={() => router.push(`/sessions/${item.info.id}`)} />
        )}
        ListHeaderComponent={
          <View className="pb-5">
            <View className="overflow-hidden rounded-[32px] border border-border bg-surface px-5 py-5">
              <View className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/15" />
              <Text className="text-[11px] font-semibold uppercase tracking-[2.2px] text-accent-light">
                Session command center
              </Text>
              <Text className="mt-2 text-[30px] font-semibold leading-[34px] text-ink">
                Track active runs, approvals, and diffs.
              </Text>
              <Text className="mt-3 text-sm leading-6 text-soft">
                GitHub-backed flows now start from Repos so every branch session can own its worktree and PR lifecycle.
              </Text>
              <View className="mt-4 flex-row items-center justify-between">
                <View className="rounded-full bg-background/70 px-3 py-2">
                  <Text className="text-[11px] font-semibold text-ink">{sessions.length} sessions</Text>
                </View>
                <Pressable
                  disabled={creating}
                  onPress={() => void createSession()}
                  className="rounded-full bg-accent px-4 py-3"
                >
                  {creating ? (
                    <ActivityIndicator color="#082f49" />
                  ) : (
                    <Text className="font-semibold text-slate-950">New local session</Text>
                  )}
                </Pressable>
              </View>
            </View>

            {error ? (
              <View className="mt-4 rounded-3xl border border-danger/35 bg-danger/10 px-4 py-4">
                <Text className="text-sm text-rose-200">{error}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View className="mt-6 items-center rounded-[30px] border border-dashed border-border bg-surface px-6 py-8">
            <Text className="text-lg font-semibold text-ink">No sessions yet</Text>
            <Text className="mt-2 text-center text-sm leading-6 text-soft">
              Create your first mobile session to monitor tool execution, review patches, and answer permission prompts.
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />
    </View>
  )
}
