import { ScrollView, Text, View, useWindowDimensions } from "react-native"
import { FileCode2, Folder, Globe, Search, Shield, SquareTerminal, type LucideIcon } from "lucide-react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { InfoChip } from "@/components/ui/InfoChip"
import type { PermissionRequest } from "@/lib/types"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

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
      <Text selectable className="text-[12px] font-medium text-muted">
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
      className="mb-3 overflow-hidden p-4"
      style={{
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.warn, 0.2),
        backgroundColor: isDark ? palette.surfaceMuted : palette.panel,
      }}
    >
      <View className="flex-row items-start gap-3">
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: hexToRgba(palette.accent, 0.2),
            backgroundColor: hexToRgba(palette.accent, 0.1),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon size={16} color={palette.accentLight} strokeWidth={2.1} />
        </View>
        <View className="min-w-0 flex-1 gap-1.5">
          <Text selectable style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>
            Permission required
          </Text>
          <Text selectable style={{ color: palette.ink, ...typeStyle(16, { weight: "600" }) }}>
            {props.item.permission || "Unknown permission"}
          </Text>
          {description ? (
            <Text selectable style={{ color: palette.soft, ...typeStyle(14) }}>
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
          <Text selectable className="text-[12px] font-medium text-muted">
            Patterns
          </Text>
          {props.item.patterns.map((pattern, index) => (
            <ScrollView
              key={`pattern-${index}-${pattern}`}
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
