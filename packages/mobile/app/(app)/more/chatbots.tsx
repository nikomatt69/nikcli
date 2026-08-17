import { useCallback, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { useFocusEffect } from "expo-router"
import * as Clipboard from "expo-clipboard"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useServer } from "@/lib/server-context"
import { triggerHaptic } from "@/lib/haptics"
import type { ChatBotInfo } from "@/lib/types"

export default function ChatbotsScreen() {
  const { client } = useServer()
  const [bots, setBots] = useState<ChatBotInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setError(null)
      setBots((await client.listChatBots()).bots)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function toggle(bot: ChatBotInfo) {
    if (!client) return
    try {
      setBusy(bot.name)
      setError(null)
      if (bot.running) {
        await client.stopChatBot(bot.name)
      } else {
        const result = await client.startChatBot(bot.name)
        if (!result.running) setError(result.error ?? `Could not start ${bot.name}`)
      }
      void triggerHaptic("success")
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      void triggerHaptic("error")
    } finally {
      setBusy(null)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background px-4 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 36, gap: 16 }}
    >
      {error ? <ErrorBanner message={error} /> : null}
      {!bots.length ? (
        <SurfaceCard
          title="No chat bots"
          description="Configure Discord, Slack, Teams, or other chat connectors on the host, then start them here."
        />
      ) : (
        bots.map((bot) => (
          <SurfaceCard key={bot.name} eyebrow={bot.type} title={bot.name}>
            <View className="flex-row flex-wrap gap-2">
              <InfoChip label={bot.running ? "Running" : "Stopped"} tone={bot.running ? "good" : "neutral"} />
            </View>
            <Text className="mt-3 text-[12px] text-soft" selectable>
              {bot.webhookPath}
            </Text>
            <View className="mt-4 flex-row gap-2">
              <View className="flex-1">
                <ActionButton
                  label={bot.running ? "Stop" : "Start"}
                  loading={busy === bot.name}
                  onPress={() => void toggle(bot)}
                />
              </View>
              <View className="flex-1">
                <ActionButton
                  label="Copy path"
                  variant="secondary"
                  onPress={() => {
                    void Clipboard.setStringAsync(bot.webhookPath)
                    void triggerHaptic("selection")
                  }}
                />
              </View>
            </View>
          </SurfaceCard>
        ))
      )}
    </ScrollView>
  )
}
