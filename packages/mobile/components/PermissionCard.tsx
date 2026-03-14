import { Pressable, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"
import type { PermissionRequest } from "@/lib/types"

type IoniconName = React.ComponentProps<typeof Ionicons>["name"]

function permissionIcon(permission: string): IoniconName {
  const p = permission.toLowerCase()
  if (p.includes("bash") || p.includes("execute") || p.includes("shell")) return "terminal-outline"
  if (p.includes("read") || p.includes("edit") || p.includes("write")) return "document-text-outline"
  if (p.includes("glob") || p.includes("list") || p.includes("directory")) return "folder-outline"
  if (p.includes("grep") || p.includes("search")) return "search-outline"
  if (p.includes("web") || p.includes("fetch") || p.includes("http")) return "globe-outline"
  return "shield-outline"
}

export function PermissionCard(props: {
  item: PermissionRequest
  onRespond(response: "once" | "always" | "reject"): void
}) {
  const icon = permissionIcon(props.item.permission)
  const meta = props.item.metadata
  return (
    <View className="mb-3 rounded-[28px] border border-accent/30 bg-panel px-4 py-4">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={16} color="#7dd3fc" />
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">
          Permission required
        </Text>
      </View>
      <Text className="mt-2 text-base font-semibold text-ink">{props.item.permission}</Text>
      {meta.description && typeof meta.description === "string" ? (
        <Text className="mt-2 text-sm leading-6 text-soft">{meta.description}</Text>
      ) : null}
      {meta.command && typeof meta.command === "string" ? (
        <Text className="mt-2 rounded-xl bg-background px-2 py-1 font-mono text-xs text-soft">{meta.command}</Text>
      ) : null}
      {(meta.path || meta.file) && typeof (meta.path ?? meta.file) === "string" ? (
        <Text className="mt-2 rounded-xl bg-background px-2 py-1 font-mono text-xs text-soft">
          {String(meta.path ?? meta.file)}
        </Text>
      ) : null}
      {props.item.patterns.length > 0 ? (
        <View className="mt-3 gap-1">
          {props.item.patterns.map((pattern, index) => (
            <Text key={index} className="font-mono text-xs text-soft">
              {pattern}
            </Text>
          ))}
        </View>
      ) : null}
      <View className="mt-4 flex-row gap-2">
        <Pressable
          className="flex-1 rounded-2xl border border-border bg-background/60 px-3 py-3"
          onPress={() => props.onRespond("reject")}
        >
          <Text className="text-center text-sm font-semibold text-rose-300">Reject</Text>
        </Pressable>
        <Pressable
          className="flex-1 rounded-2xl border border-border bg-background/60 px-3 py-3"
          onPress={() => props.onRespond("once")}
        >
          <Text className="text-center text-sm font-semibold text-ink">Allow once</Text>
        </Pressable>
        <Pressable className="flex-1 rounded-2xl bg-accent px-3 py-3" onPress={() => props.onRespond("always")}>
          <Text className="text-center text-sm font-semibold text-slate-950">Always</Text>
        </Pressable>
      </View>
      <Text className="mt-2 text-[10px] text-soft">Always allows this pattern until Nikcli restarts</Text>
    </View>
  )
}
