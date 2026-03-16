import { useCallback, useMemo, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import { type AgentInfo } from "@/lib/types"

export default function AgentsSettingsScreen() {
  const { client } = useServer()
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [notAvailable, setNotAvailable] = useState(false)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setNotAvailable(false)
      setAgents(await client.listAgents())
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes("404") || msg.includes("not found") || msg.includes("Unexpected") || msg.includes("JSON")) {
        setNotAvailable(true)
      } else {
        setMessage(msg)
      }
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const visibleAgents = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return agents
    return agents.filter((agent) =>
      [agent.name, agent.id, agent.description ?? "", ...(agent.tools ?? [])].some((value) =>
        value.toLowerCase().includes(term),
      ),
    )
  }, [search, agents])

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "Agents" }} />

      <SurfaceCard
        eyebrow="Agent catalog"
        title="Built-in and custom AI agents"
        description="Browse agents registered on this host, inspect their tool selections, and understand what automation profiles are available."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${agents.length} agents`} tone={agents.length ? "accent" : "neutral"} />
          <InfoChip label={`${agents.filter((a) => a.isDefault).length} default`} />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      {notAvailable ? (
        <SurfaceCard
          eyebrow="Unavailable"
          title="Agents not available"
          description="This server does not expose an agent API. Update the server to enable agent browsing."
        >
          <InfoChip label="Not available on this server" tone="warn" />
        </SurfaceCard>
      ) : (
        <SurfaceCard
          eyebrow="Search"
          title="Find an agent quickly"
          description="Filter by name, description, or tools."
        >
          <View className="gap-3">
            <TextField
              label="Search agents"
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              placeholder="Search agents, tools, descriptions"
            />
            {loading ? (
              <View className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
                <Text className="text-sm leading-6 text-soft">Loading agents…</Text>
              </View>
            ) : (
              <View className="gap-3">
                {visibleAgents.length ? (
                  visibleAgents.map((agent) => (
                    <View key={agent.id} className="rounded-[24px] border border-border bg-background/60 px-4 py-4">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text className="text-base font-semibold text-ink">{agent.name}</Text>
                        {agent.isDefault ? <InfoChip label="Default" tone="accent" /> : null}
                      </View>
                      {agent.description ? (
                        <Text className="mt-2 text-sm leading-6 text-soft">{agent.description}</Text>
                      ) : null}
                      {agent.tools?.length ? (
                        <View className="mt-2 flex-row flex-wrap gap-1.5">
                          {agent.tools.map((tool) => (
                            <InfoChip key={tool} label={tool} tone="neutral" />
                          ))}
                        </View>
                      ) : null}
                      <Text selectable className="mt-2 text-xs text-soft font-mono">
                        {agent.id}
                      </Text>
                    </View>
                  ))
                ) : (
                  <View className="rounded-[24px] border border-border bg-background/60 px-4 py-4">
                    <Text className="text-sm leading-6 text-soft">
                      No agents matched this search or the host has not registered any agents yet.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </SurfaceCard>
      )}
    </ScrollView>
  )
}
