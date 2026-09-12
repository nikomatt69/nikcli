import { ScrollView, Text, View } from "react-native"
import { Link, type Href } from "expo-router"
import type { ReactNode } from "react"
import { SettingsGroup, SettingsNavCard } from "@/components/settings/SettingsNavCard"
import { CenteredScreenHeader } from "@/components/layout/CenteredScreenHeader"
import { SettingsCircleButton } from "@/components/layout/ScreenBrandHeader"
import { Divider } from "@/components/ui/Divider"
import { SectionHeader } from "@/components/ui/SectionHeader"
import { TipsCard } from "@/components/ui/TipsCard"
import { useServer } from "@/lib/server-context"
import { useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <SectionHeader label={label} />
      <SettingsGroup>{children}</SettingsGroup>
    </View>
  )
}

export default function MoreScreen() {
  const { config } = useServer()
  const { palette } = useAppTheme()
  const hostLabel = config?.url ? config.url.replace(/^https?:\/\//, "") : "No host linked"

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 96, gap: 20 }}
    >
      <View style={{ gap: 8 }}>
        <CenteredScreenHeader title="Tools" brand right={<SettingsCircleButton />} />
        <Text selectable style={{ color: palette.soft, ...typeStyle(13) }}>
          Automation, host controls, and appearance for this workspace.
        </Text>
      </View>

      <TipsCard />

      <Section label="Automation">
        <Link href={"/more/missions" as Href} asChild>
          <SettingsNavCard
            title="Missions"
            description="Multi-milestone autonomous work with a live plan and history."
            badges={["Start", "Pause", "History"]}
          />
        </Link>
        <Divider inset={20} />
        <Link href="/more/loops" asChild>
          <SettingsNavCard
            title="Loops"
            description="Run recurring work and review past iterations."
            badges={["Recurring runs", "History"]}
          />
        </Link>
        <Divider inset={20} />
        <Link href={"/more/brain" as Href} asChild>
          <SettingsNavCard
            title="Brain"
            description="Consolidate recent sessions into long-term memory on the host."
            badges={["On demand"]}
          />
        </Link>
      </Section>

      <Section label="Host">
        <Link href={"/more/chatbots" as Href} asChild>
          <SettingsNavCard
            title="Chatbots"
            description="Start and stop Discord, Slack, and other chat bots on the host."
          />
        </Link>
        <Divider inset={20} />
        <Link href={"/more/observability" as Href} asChild>
          <SettingsNavCard
            title="Observability"
            description="Toggle OpenTelemetry and inspect OTLP export status."
          />
        </Link>
        <Divider inset={20} />
        <Link href={"/more/host" as Href} asChild>
          <SettingsNavCard
            title="Host status"
            description="Browser, computer use, Herdr, Island, and runtime health."
            badges={[hostLabel]}
          />
        </Link>
      </Section>

      <Section label="Appearance">
        <Link href={"/more/settings/appearance" as Href} asChild>
          <SettingsNavCard
            title="Appearance"
            description="Wallpaper, math rendering, and rotating tips."
          />
        </Link>
        <Divider inset={20} />
        <Link href="/more/settings/providers" asChild>
          <SettingsNavCard
            title="Fusion"
            description="OpenRouter Fusion presets live with models in Settings."
          />
        </Link>
        <Divider inset={20} />
        <Link href="/more/settings" asChild>
          <SettingsNavCard
            title="Settings"
            description="Host, models, integrations, security, and appearance."
            badges={[hostLabel]}
          />
        </Link>
      </Section>
    </ScrollView>
  )
}
