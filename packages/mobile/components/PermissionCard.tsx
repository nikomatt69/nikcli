import { Pressable, Text, View } from "react-native"
import { FileCode2, Folder, Globe, Search, Shield, SquareTerminal, type LucideIcon } from "lucide-react-native"
import type { PermissionRequest } from "@/lib/types"

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

export function PermissionCard(props: {
  item: PermissionRequest
  onRespond(response: "once" | "always" | "reject"): void
}) {
  const Icon = permissionIcon(props.item.permission)
  const meta = props.item.metadata
  const description = asText(meta.description)
  const command = asText(meta.command)
  const path = asText(meta.path ?? meta.file)

  return (
    <View className="mb-3 rounded-[30px] border border-accent/30 bg-panel px-4 py-4">
      <View className="flex-row items-center gap-2">
        <View className="rounded-full border border-accent/20 bg-accent/10 p-2">
          <Icon size={15} color="#7dd3fc" strokeWidth={2.1} />
        </View>
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">Permission required</Text>
      </View>
      <Text className="mt-2 text-base font-semibold text-ink">{props.item.permission || "Unknown permission"}</Text>
      {description ? <Text className="mt-2 text-sm leading-6 text-soft">{description}</Text> : null}
      {command ? <Text className="mt-2 rounded-2xl bg-background px-3 py-2 font-mono text-xs text-soft">{command}</Text> : null}
      {path ? <Text className="mt-2 rounded-2xl bg-background px-3 py-2 font-mono text-xs text-soft">{path}</Text> : null}
      {props.item.patterns.length > 0 ? (
        <View className="mt-3 gap-1">
          {props.item.patterns.map((pattern, index) => (
            <Text key={index} className="font-mono text-xs text-soft">{pattern || "*"}</Text>
          ))}
        </View>
      ) : null}
      <View className="mt-4 flex-row gap-2">
        <Pressable
          className="flex-1 rounded-[20px] border border-border bg-background/60 px-3 py-3"
          onPress={() => props.onRespond("reject")}
        >
          <Text className="text-center text-sm font-semibold text-rose-300">Reject</Text>
        </Pressable>
        <Pressable
          className="flex-1 rounded-[20px] border border-border bg-background/60 px-3 py-3"
          onPress={() => props.onRespond("once")}
        >
          <Text className="text-center text-sm font-semibold text-ink">Allow once</Text>
        </Pressable>
        <Pressable className="flex-1 rounded-[20px] bg-accent px-3 py-3" onPress={() => props.onRespond("always")}>
          <Text className="text-center text-sm font-semibold text-slate-950">Always</Text>
        </Pressable>
      </View>
      <Text className="mt-2 text-[10px] text-soft">Always allows this pattern until Nikcli restarts</Text>
    </View>
  )
}
