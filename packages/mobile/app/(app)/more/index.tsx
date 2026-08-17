import { ScrollView, Text, View } from "react-native"
import { Link, type Href } from "expo-router"
import type { ReactNode } from "react"
import {
  Activity,
  Brain,
  Bot,
  ImageIcon,
  Monitor,
  Repeat,
  Settings as SettingsIcon,
  Sparkles,
  Target,
} from "lucide-react-native"
import { SettingsNavCard } from "@/components/settings/SettingsNavCard"
import { ScreenBrandHeader } from "@/components/layout/ScreenBrandHeader"
import { Divider } from "@/components/ui/Divider"
import { TipsCard } from "@/components/ui/TipsCard"
import { useServer } from "@/lib/server-context"
import { hexToRgba, useAppTheme } from "@/lib/theme"

function Group({ children }: { children: ReactNode }) {
  const { palette } = useAppTheme()
  return (
    <View
      className="overflow-hidden bg-surface"
      style={{
        borderRadius: 18,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.ink, 0.08),
      }}
    >
      {children}
    </View>
  )
}

export default function MoreScreen() {
  const { config } = useServer()
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
          Automation, host controls, and appearance for this workspace.
        </Text>
        <TipsCard />

        <Text className="px-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-muted">Automation</Text>
        <Group>
          <Link href={"/more/missions" as Href} asChild>
            <SettingsNavCard
              icon={Target}
              eyebrow="Automation"
              title="Missions"
              description="Multi-milestone autonomous work with a live plan and history."
              badges={["Start", "Pause", "History"]}
            />
          </Link>
          <Divider inset={65} />
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
          <Link href={"/more/brain" as Href} asChild>
            <SettingsNavCard
              icon={Brain}
              eyebrow="Memory"
              title="Brain"
              description="Consolidate recent sessions into long-term memory on the host."
              badges={["On demand"]}
            />
          </Link>
        </Group>

        <Text className="px-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-muted">Host</Text>
        <Group>
          <Link href={"/more/chatbots" as Href} asChild>
            <SettingsNavCard
              icon={Bot}
              eyebrow="Connectors"
              title="Chatbots"
              description="Start and stop Discord, Slack, and other chat bots on the host."
            />
          </Link>
          <Divider inset={65} />
          <Link href={"/more/observability" as Href} asChild>
            <SettingsNavCard
              icon={Activity}
              eyebrow="Telemetry"
              title="Observability"
              description="Toggle OpenTelemetry and inspect OTLP export status."
            />
          </Link>
          <Divider inset={65} />
          <Link href={"/more/host" as Href} asChild>
            <SettingsNavCard
              icon={Monitor}
              eyebrow="Machine"
              title="Host status"
              description="Browser, computer use, Herdr, Island, and runtime health."
              badges={[hostLabel]}
            />
          </Link>
        </Group>

        <Text className="px-1 text-[12px] font-semibold uppercase tracking-[0.6px] text-muted">Appearance</Text>
        <Group>
          <Link href={"/more/settings/appearance" as Href} asChild>
            <SettingsNavCard
              icon={ImageIcon}
              eyebrow="Session"
              title="Appearance"
              description="Wallpaper, math rendering, and rotating tips."
            />
          </Link>
          <Divider inset={65} />
          <Link href="/more/settings/providers" asChild>
            <SettingsNavCard
              icon={Sparkles}
              eyebrow="Models"
              title="Fusion"
              description="OpenRouter Fusion presets live with models in Settings."
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
        </Group>
      </View>
    </ScrollView>
  )
}
