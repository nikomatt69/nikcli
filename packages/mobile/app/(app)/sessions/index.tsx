import { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, RefreshControl, Text, View } from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SessionListItem } from "@/components/SessionListItem"
import { SessionListSkeleton } from "@/components/Skeleton"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import { MOBILE_DEFAULT_MODEL_ID, MOBILE_DEFAULT_PROVIDER_ID, type SessionSummary } from "@/lib/types"

function currentProjectLabel(name?: string, worktree?: string) {
  if (name) return name
  if (!worktree) return "No active workspace"
  return worktree.split("/").filter(Boolean).pop() || worktree
}

function currentSessionModelLabel(providerID?: string, modelID?: string) {
  return {
    providerID: providerID ?? MOBILE_DEFAULT_PROVIDER_ID,
    modelID: modelID ?? MOBILE_DEFAULT_MODEL_ID,
  }
}

export default function SessionsScreen() {
  const { client, loading, bootstrapLoading, config, bootstrap } = useServer()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const load = useCallback(
    async (term?: string) => {
      if (!client) {
        setSessions([])
        setError(null)
        return
      }

      try {
        setRefreshing(true)
        setError(null)
        setSessions(await client.listSessions(term?.trim() || undefined))
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      } finally {
        setRefreshing(false)
      }
    },
    [client],
  )

  useEffect(() => {
    if (!client) return
    const timer = setTimeout(() => {
      void load(search)
    }, 180)
    return () => clearTimeout(timer)
  }, [client, load, search])

  useFocusEffect(
    useCallback(() => {
      if (loading) return
      if (!config) {
        router.replace("/")
        return
      }
      void load(search)
    }, [config, load, loading, search]),
  )

  async function createSession() {
    if (!client || creating) return
    try {
      setCreating(true)
      setError(null)
      const session = await client.createSession({ title: "Mobile session" })
      router.push(`/sessions/${session.id}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setCreating(false)
    }
  }

  const busyCount = useMemo(() => sessions.filter((item) => item.status?.type === "busy").length, [sessions])
  const githubCount = useMemo(() => sessions.filter((item) => item.info.github).length, [sessions])
  const retryCount = useMemo(() => sessions.filter((item) => item.status?.type === "retry").length, [sessions])
  const sessionModel = useMemo(
    () => currentSessionModelLabel(config?.modelProviderID, config?.modelID),
    [config?.modelID, config?.modelProviderID],
  )

  const hero = (
    <View className="pb-5">
      <SurfaceCard
        eyebrow="Operations board"
        title="Track live runs, approvals, and publish readiness."
        description="Use this board to triage in-flight sessions, inspect repo-backed work, and jump straight into the execution timeline that needs your attention."
      >
        <View className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent/15" />
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${sessions.length} sessions`} tone="accent" />
          <InfoChip label={`${busyCount} busy`} tone={busyCount ? "accent" : "neutral"} />
          <InfoChip label={`${retryCount} retry`} tone={retryCount ? "warn" : "neutral"} />
          <InfoChip label={`${githubCount} GitHub-linked`} />
          <InfoChip label={sessionModel.providerID} />
          <InfoChip label={sessionModel.modelID} tone="accent" />
          <InfoChip label={currentProjectLabel(bootstrap?.currentProject?.name, bootstrap?.currentProject?.worktree)} />
        </View>
        <View className="mt-4 flex-row items-center gap-3">
          <View className="flex-1">
            <TextField
              value={search}
              onChangeText={setSearch}
              placeholder="Search sessions, repos, or branches"
              autoCapitalize="none"
            />
          </View>
          <View className="w-[152px]">
            <ActionButton label="New session" loading={creating} onPress={() => void createSession()} />
          </View>
        </View>
      </SurfaceCard>
      {error ? (
        <View className="mt-4">
          <ErrorBanner message={error} />
        </View>
      ) : null}
    </View>
  )

  if ((loading || bootstrapLoading) && sessions.length === 0) {
    return (
      <View className="flex-1 bg-background px-4 pt-4">
        {hero}
        <SessionListSkeleton />
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
        renderItem={({ item, index }) => (
          <SessionListItem item={item} index={index} onPress={() => router.push(`/sessions/${item.info.id}`)} />
        )}
        ListHeaderComponent={hero}
        ListEmptyComponent={
          <EmptyState
            title="No sessions yet"
            description="Create your first mobile session to monitor tool execution, review diffs, and answer permission prompts from a single enterprise console."
            action={
              <ActionButton label="Create local session" loading={creating} onPress={() => void createSession()} />
            }
          />
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />
    </View>
  )
}
