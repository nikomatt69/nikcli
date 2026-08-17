import { useEffect, useMemo, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { router, type Href } from "expo-router"
import { SheetShell, useSheetScrollProps } from "@/components/ui/SheetShell"
import { InfoChip } from "@/components/ui/InfoChip"
import { ActionButton } from "@/components/ui/ActionButton"
import { useServer } from "@/lib/server-context"
import { relativeTime } from "@/lib/types"
import type { GitState, HostMcpStatus, LspServerStatus, SessionDetail, SessionTodo } from "@/lib/types"

export function SessionInspectorSheet(props: {
  visible: boolean
  sessionID: string
  detail: SessionDetail | null
  gitState?: GitState | null
  onClose(): void
}) {
  const { client } = useServer()
  const scrollProps = useSheetScrollProps()
  const [todos, setTodos] = useState<SessionTodo[]>([])
  const [mcp, setMcp] = useState<Record<string, HostMcpStatus>>({})
  const [lsp, setLsp] = useState<LspServerStatus[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!client || !props.visible) return
    let cancelled = false
    void (async () => {
      try {
        setError(null)
        const [todoResult, mcpResult, lspResult] = await Promise.all([
          client.getSessionTodos(props.sessionID).catch(() => ({ todos: [] })),
          client.listMcpStatus().catch(() => ({})),
          client.listLspStatus().catch(() => ({ servers: [] })),
        ])
        if (cancelled) return
        setTodos(todoResult.todos)
        setMcp(mcpResult)
        setLsp(lspResult.servers)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, props.sessionID, props.visible])

  const files = useMemo(() => {
    const git = props.gitState
    if (!git) return []
    const paths = [
      ...git.staged.map((file) => file.path),
      ...git.unstaged.map((file) => file.path),
      ...git.untracked,
    ]
    return [...new Set(paths)]
  }, [props.gitState])

  const info = props.detail?.info
  const summary = info?.summary

  return (
    <SheetShell visible={props.visible} onClose={props.onClose} accessibilityLabel="Session inspector">
      <ScrollView {...scrollProps} contentContainerStyle={{ padding: 20, paddingBottom: 36, gap: 18 }}>
        <Text className="text-[12px] font-medium text-muted">Session inspector</Text>
        <Text className="text-[20px] font-bold tracking-[-0.4px] text-ink">{info?.title || "Session"}</Text>
        {error ? <Text className="text-[13px] text-soft">{error}</Text> : null}

        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-ink">Context</Text>
          <View className="flex-row flex-wrap gap-2">
            {props.detail?.status?.type ? (
              <InfoChip
                label={props.detail.status.type}
                tone={props.detail.status.type === "busy" ? "accent" : "good"}
              />
            ) : null}
            {info?.time.updated ? <InfoChip label={relativeTime(info.time.updated)} tone="neutral" /> : null}
            {props.detail?.permissions.length ? (
              <InfoChip label={`${props.detail.permissions.length} approvals`} tone="warn" />
            ) : null}
            {summary ? (
              <InfoChip
                label={`${summary.files} files · +${summary.additions} −${summary.deletions}`}
                tone="neutral"
              />
            ) : null}
          </View>
          {info?.directory ? (
            <Text className="text-[13px] text-soft" selectable>
              {info.directory}
            </Text>
          ) : null}
        </View>

        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-ink">Todos</Text>
          {!todos.length ? <Text className="text-[13px] text-soft">No open todos.</Text> : null}
          {todos.map((todo) => (
            <View key={todo.id} className="flex-row items-center gap-2">
              <InfoChip
                label={todo.status}
                tone={todo.status === "completed" ? "good" : todo.status === "in_progress" ? "accent" : "neutral"}
              />
              <Text className="min-w-0 flex-1 text-[13px] text-ink">{todo.content}</Text>
            </View>
          ))}
        </View>

        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-ink">MCP</Text>
          {!Object.keys(mcp).length ? <Text className="text-[13px] text-soft">No MCP servers reported.</Text> : null}
          {Object.entries(mcp).map(([name, status]) => (
            <View key={name} className="flex-row items-center gap-2">
              <InfoChip label={status.status} tone={status.status === "connected" ? "good" : "warn"} />
              <Text className="text-[13px] text-ink">{name}</Text>
            </View>
          ))}
        </View>

        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-ink">LSP</Text>
          {!lsp.length ? <Text className="text-[13px] text-soft">LSPs activate as files are read on the host.</Text> : null}
          {lsp.map((server) => (
            <View key={`${server.id}-${server.root}`} className="flex-row items-center gap-2">
              <InfoChip label={server.status} tone={server.status === "connected" ? "good" : "warn"} />
              <Text className="min-w-0 flex-1 text-[13px] text-ink">
                {server.name} · {server.root}
              </Text>
            </View>
          ))}
        </View>

        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-ink">Files</Text>
          {!files.length ? (
            <Text className="text-[13px] text-soft">No modified files reported for this workspace yet.</Text>
          ) : (
            files.slice(0, 12).map((path) => (
              <Text key={path} className="text-[13px] text-ink" numberOfLines={1}>
                {path}
              </Text>
            ))
          )}
        </View>

        <ActionButton
          label="Open files"
          variant="secondary"
          onPress={() => {
            props.onClose()
            router.push("/sessions/explorer" as Href)
          }}
        />
      </ScrollView>
    </SheetShell>
  )
}
