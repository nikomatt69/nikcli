import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import { FileCode2, Folder, Globe, Search, Shield, SquareTerminal, type LucideIcon } from "lucide-react-native"
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
    <View className="gap-1.5 rounded-[18px] border border-border/70 bg-background/80 px-3 py-2.5">
      <Text className="text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">{props.label}</Text>
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
  const { palette } = useAppTheme()
  const Icon = permissionIcon(props.item.permission)
  const meta = props.item.metadata
  const description = asText(meta.description)
  const command = asText(meta.command)
  const path = asText(meta.path ?? meta.file)
  const compactActions = width < 410
  const alwaysCount = props.item.always.length

  return (
    <View className="mb-3 overflow-hidden rounded-[28px] border border-accent/30 bg-panel px-4 py-4">
      <View className="flex-row items-start gap-3">
        <View className="rounded-[16px] border border-accent/20 bg-accent/10 p-2.5">
          <Icon size={15} color={palette.accentLight} strokeWidth={2.1} />
        </View>
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">
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
        <View className="rounded-full border border-border/70 bg-background/80 px-3 py-2">
          <Text className="text-[10px] font-semibold uppercase tracking-[1.4px] text-soft">
            {props.item.patterns.length} pattern{props.item.patterns.length === 1 ? "" : "s"}
          </Text>
        </View>
        {alwaysCount ? (
          <View className="rounded-full border border-accent/20 bg-accent/10 px-3 py-2">
            <Text className="text-[10px] font-semibold uppercase tracking-[1.4px] text-accent-light">
              {alwaysCount} remembered
            </Text>
          </View>
        ) : null}
      </View>

      <View className="mt-3 gap-2">
        <DataBlock label="Command" value={command} />
        <DataBlock label="Path" value={path} />
      </View>

      {props.item.patterns.length > 0 ? (
        <View className="mt-3 gap-2 rounded-[18px] border border-border/70 bg-background/80 px-3 py-2.5">
          <Text className="text-[10px] font-semibold uppercase tracking-[1.5px] text-accent-light">Patterns</Text>
          {props.item.patterns.map((pattern, index) => (
            <ScrollView
              key={index}
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
        <Pressable
          className={`rounded-[18px] border border-border bg-background/60 px-3 py-3 ${compactActions ? "" : "flex-1"}`}
          onPress={() => props.onRespond("reject")}
        >
          <Text className="text-center text-sm font-semibold text-rose-300">Reject</Text>
        </Pressable>
        <Pressable
          className={`rounded-[18px] border border-border bg-background/60 px-3 py-3 ${compactActions ? "" : "flex-1"}`}
          onPress={() => props.onRespond("once")}
        >
          <Text className="text-center text-sm font-semibold text-ink">Allow once</Text>
        </Pressable>
        <Pressable
          className={`rounded-[18px] bg-accent px-3 py-3 ${compactActions ? "" : "flex-1"}`}
          onPress={() => props.onRespond("always")}
        >
          <Text className="text-center text-sm font-semibold text-slate-950">Always</Text>
        </Pressable>
      </View>
      <Text selectable className="mt-2 text-[10px] leading-4 text-soft">
        Always remembers this permission scope until Nikcli restarts. Use it only when the command and path look safe.
      </Text>
    </View>
  )
}
