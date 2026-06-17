import { ScrollView, Text, View } from "react-native"
import { Link } from "expo-router"
import { Repeat, Settings as SettingsIcon } from "lucide-react-native"
import { SettingsNavCard } from "@/components/settings/SettingsNavCard"
import { useServer } from "@/lib/server-context"

export default function MoreScreen() {
  const { config } = useServer()
  const hostLabel = config?.url ? config.url.replace(/^https?:\/\//, "") : "No host linked"

  return (
    <ScrollView
      className="flex-1 bg-background px-4 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 28 }}
    >
      <View className="gap-3">
        <Text className="px-1 text-[13px] leading-[18px] text-soft">
          Less-used tools and configuration for this workspace.
        </Text>

        <Link href="/more/loops" asChild>
          <SettingsNavCard
            icon={Repeat}
            eyebrow="Automation"
            title="Loops"
            description="Run a prompt or command on a recurring schedule and review past iterations."
            badges={["Recurring runs", "History"]}
          />
        </Link>

        <Link href="/more/settings" asChild>
          <SettingsNavCard
            icon={SettingsIcon}
            eyebrow="Configuration"
            title="Settings"
            description="Host connection, models, GitHub, integrations, security, and appearance."
            badges={[hostLabel]}
          />
        </Link>
      </View>
    </ScrollView>
  )
}
