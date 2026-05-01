import { ScrollView, Text, View, useWindowDimensions } from "react-native"
import { FileCode2, Folder, Globe, Search, Shield, SquareTerminal, type LucideIcon } from "lucide-react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { InfoChip } from "@/components/ui/InfoChip"
import type { PermissionRequest } from "@/lib/types"
import { useAppTheme } from "@/lib/theme"

function permissionIcon(permission: string): LucideIcon {
  const value = permission.toLowerCase()
  if (value.includes("bash") || value.includes("execute") || value.includes("shell")) return SquareTerminal
  if (value.includes("read") || value.includes("edit") || value.includes("write")) return FileCode2
  if (value.includes("glob") || value.includes("list") || value.includes("directory")) return Folder
  if (value.includes("grep") || value.includes("search")) return Search
  if (value.includes("web") || value.includes("fetch") || value.includes("http")) return Globe
  return Shield
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function DataBlock(props: { label: string; value: string }) {
  if (!props.value) return null

  return (
    <View className="gap-1.5 rounded-[8px] border border-border/70 bg-background/80 px-3 py-2.5">
      <Text selectable className="text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">
        {props.label}
      </Text>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ alignSelf: "flex-start" }}
      >
        <Text selectable className="font-mono text-xs leading-5 text-soft">
          {props.value}
        </Text>
      </ScrollView>
    </View>
  )
}

export function PermissionCard(props: {
  item: PermissionRequest
  onRespond(response: "once" | "always" | "reject"): void
}) {
  const { width } = useWindowDimensions()
  const { palette, isDark } = useAppTheme()
  const Icon = permissionIcon(props.item.permission)
  const meta = props.item.metadata
  const description = asText(meta.description)
  const command = asText(meta.command)
  const path = asText(meta.path ?? meta.file)
  const compactActions = width < 410
  const alwaysCount = props.item.always.length

  return (
    <View
      className="mb-3 overflow-hidden rounded-[8px] border px-4 py-4"
      style={{
        borderColor: isDark ? "rgba(251,191,36,0.20)" : "rgba(217,119,6,0.20)",
        backgroundColor: isDark ? palette.surfaceMuted : palette.panel,
      }}
    >
      <View className="flex-row items-start gap-3">
        <View className="rounded-[8px] border border-accent/20 bg-accent/10 p-2.5">
          <Icon size={15} color={palette.accentLight} strokeWidth={2.1} />
        </View>
        <View className="min-w-0 flex-1 gap-1.5">
          <Text selectable className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light">
            Permission required
          </Text>
          <Text selectable className="text-base font-semibold text-ink">
            {props.item.permission || "Unknown permission"}
          </Text>
          {description ? (
            <Text selectable className="text-sm leading-5 text-soft">
              {description}
            </Text>
          ) : null}
        </View>
      </View>

      <View className="mt-3 flex-row flex-wrap gap-2">
        <InfoChip
          label={`${props.item.patterns.length} pattern${props.item.patterns.length === 1 ? "" : "s"}`}
          tone="neutral"
        />
        {alwaysCount ? <InfoChip label={`${alwaysCount} remembered`} tone="accent" /> : null}
        {command ? <InfoChip label="Command scope" tone="accent" /> : null}
        {path ? <InfoChip label="Path scoped" tone="neutral" /> : null}
      </View>

      <View className="mt-3 gap-2">
        <DataBlock label="Command" value={command} />
        <DataBlock label="Path" value={path} />
      </View>

      {props.item.patterns.length > 0 ? (
        <View className="mt-3 gap-2 rounded-[8px] border border-border/70 bg-background/80 px-3 py-2.5">
          <Text selectable className="text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">
            Patterns
          </Text>
          {props.item.patterns.map((pattern, index) => (
            <ScrollView
              key={`${pattern || "*"}:${index}`}
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ alignSelf: "flex-start" }}
            >
              <Text selectable className="font-mono text-xs leading-5 text-soft">
                {pattern || "*"}
              </Text>
            </ScrollView>
          ))}
        </View>
      ) : null}

      <View className={`mt-4 gap-2 ${compactActions ? "" : "flex-row"}`}>
        <View className={compactActions ? "w-full" : "flex-1"}>
          <ActionButton
            label="Reject"
            variant="danger"
            accessibilityLabel={`Reject permission ${props.item.permission}`}
            onPress={() => props.onRespond("reject")}
          />
        </View>
        <View className={compactActions ? "w-full" : "flex-1"}>
          <ActionButton
            label="Allow once"
            variant="secondary"
            accessibilityLabel={`Allow permission once ${props.item.permission}`}
            onPress={() => props.onRespond("once")}
          />
        </View>
        <View className={compactActions ? "w-full" : "flex-1"}>
          <ActionButton
            label="Always allow"
            accessibilityLabel={`Always allow permission ${props.item.permission}`}
            accessibilityHint="Remembers this permission scope until Nikcli restarts"
            onPress={() => props.onRespond("always")}
          />
        </View>
      </View>
      <Text selectable className="mt-2 text-[10px] leading-4 text-soft">
        Always remembers this permission scope until Nikcli restarts. Use it only when the command and path look safe.
      </Text>
    </View>
  )
}
