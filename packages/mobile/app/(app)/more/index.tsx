import { ScrollView, Text, View } from "react-native"
import { Link } from "expo-router"
import { Repeat, Settings as SettingsIcon } from "lucide-react-native"
import { SettingsNavCard } from "@/components/settings/SettingsNavCard"
import { ScreenBrandHeader } from "@/components/layout/ScreenBrandHeader"
import { Divider } from "@/components/ui/Divider"
import { useServer } from "@/lib/server-context"
import { hexToRgba, useAppTheme } from "@/lib/theme"

export default function MoreScreen() {
  const { config } = useServer()
  const { palette } = useAppTheme()
  const hostLabel = config?.url ? config.url.replace(/^https?:\/\//, "") : "No host linked"

  return (
    <ScrollView
      className="flex-1 bg-background px-4 pt-4"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 28 }}
    >
      <View className="gap-4">
        <ScreenBrandHeader title="Tools" />
        <Text className="px-1 text-[13px] leading-[19px] text-soft">
          Automation and configuration for this workspace.
        </Text>

        <View
          className="overflow-hidden bg-surface"
          style={{
            borderRadius: 18,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: hexToRgba(palette.ink, 0.08),
          }}
        >
          <Link href="/more/loops" asChild>
            <SettingsNavCard
              icon={Repeat}
              eyebrow="Automation"
              title="Loops"
              description="Run recurring work and review past iterations."
              badges={["Recurring runs", "History"]}
            />
          </Link>
          <Divider inset={65} />
          <Link href="/more/settings" asChild>
            <SettingsNavCard
              icon={SettingsIcon}
              eyebrow="Configuration"
              title="Settings"
              description="Host, models, integrations, security, and appearance."
              badges={[hostLabel]}
            />
          </Link>
        </View>
      </View>
    </ScrollView>
  )
}
