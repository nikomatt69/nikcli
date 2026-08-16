import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect, type DialogSelectRef, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@tui/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../ui/toast"
import { MCP_CATALOG } from "./mcp-catalog"
import type { McpLocalConfig } from "@nikcli-ai/sdk/httpapi"

type McpRowValue = { kind: "installed"; name: string } | { kind: "catalog"; index: number }

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.foreground.muted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.status.success.fg, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.foreground.muted }}>○ Disabled</span>
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const [, setRef] = createSignal<DialogSelectRef<unknown>>()
  const [loading, setLoading] = createSignal<string | null>(null)
  const [selectedValue, setSelectedValue] = createSignal<McpRowValue | undefined>()

  const options = createMemo((): DialogSelectOption<McpRowValue>[] => {
    const mcpData = sync.data.mcp
    const loadingMcp = loading()
    const configuredNames = new Set(Object.keys(mcpData ?? {}))

    const installedRows: DialogSelectOption<McpRowValue>[] = pipe(
      mcpData ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: { kind: "installed" as const, name },
        title: name,
        description: status.status === "failed" ? "failed" : status.status,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} />,
        category: "Configured",
      })),
    )

    const catalogRows: DialogSelectOption<McpRowValue>[] = MCP_CATALOG.filter(
      (entry) => !configuredNames.has(entry.name),
    ).map((entry, i) => ({
      value: { kind: "catalog" as const, index: i },
      title: entry.name,
      description: entry.description,
      footer: <span style={{ fg: theme.foreground.muted }}>not configured</span>,
      category: "Catalog",
    }))

    return [...installedRows, ...catalogRows]
  })

  async function addFromCatalog(index: number) {
    const entry = MCP_CATALOG[index]
    if (!entry) return
    const command = entry.config.command.map((s) => (s === "__CWD__" ? process.cwd() : s))
    const config: McpLocalConfig = { ...entry.config, command }
    setLoading(entry.name)
    try {
      await sdk.client.mcp.add({ name: entry.name, config })
      const status = await sdk.client.mcp.status()
      if (status.data) sync.set("mcp", status.data)
      if (entry.requiredEnv?.length) {
        toast.show({
          variant: "info",
          message: `Set env vars: ${entry.requiredEnv.join(", ")}`,
          duration: 6000,
        })
      }
    } catch {
      toast.show({ variant: "error", message: `Failed to add ${entry.name}` })
    } finally {
      setLoading(null)
    }
  }

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: selectedValue()?.kind === "catalog" ? "add" : "toggle",
      disabled: loading() !== null,
      onTrigger: async (option: DialogSelectOption<McpRowValue>) => {
        if (loading() !== null) return
        const val = option.value
        if (val.kind === "catalog") {
          await addFromCatalog(val.index)
          return
        }
        setLoading(val.name)
        try {
          await local.mcp.toggle(val.name)
          const status = await sdk.client.mcp.status()
          if (status.data) {
            sync.set("mcp", status.data)
          } else {
            console.error("Failed to refresh MCP status: no data returned")
          }
        } catch (error) {
          console.error("Failed to toggle MCP:", error)
        } finally {
          setLoading(null)
        }
      },
    },
  ])

  return (
    <DialogSelect
      ref={setRef}
      title="MCPs"
      options={options()}
      keybind={keybinds()}
      onMove={(item) => setSelectedValue(item.value)}
      onSelect={() => {}}
    />
  )
}
