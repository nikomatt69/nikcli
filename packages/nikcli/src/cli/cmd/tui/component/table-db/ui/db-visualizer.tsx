import { createMemo, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../../../context/theme"
import { useSync } from "../../../context/sync"
import { tableRenderer } from "./table-renderer"
import type { DBTable, TablePreview, TableChange } from "../db/types"

interface DBVisualizerProps {
  tables?: DBTable[]
  preview?: TablePreview[]
  changes?: TableChange[]
  mode: "schema" | "preview" | "diff"
  filePath?: string
}

export function DBVisualizer(props: DBVisualizerProps) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const sync = useSync()

  const tables = createMemo(() => {
    if (props.filePath && sync.data.dbschema[props.filePath]) {
      return sync.data.dbschema[props.filePath].tables
    }
    return props.tables || []
  })

  const renderedContent = createMemo(() => {
    const width = dimensions().width
    const tableList = tables()

    switch (props.mode) {
      case "schema":
        return tableRenderer.renderSchemaOverview(tableList, width)
      case "preview":
        if (props.preview && props.preview.length > 0) {
          return props.preview
            .map((p) => `=== ${p.tableName} ===\n${tableRenderer.renderPreview(p, width)}`)
            .join("\n\n")
        }
        return tableRenderer.renderSchemaOverview(tableList, width)
      case "diff":
        return tableRenderer.renderDiffSummary(props.changes || [], width)
      default:
        return tableRenderer.renderSchemaOverview(tableList, width)
    }
  })

  const stats = createMemo(() => tableRenderer.renderStats(tables()))

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.success}>◈ {stats().tables} tables</text>
        <text fg={theme.primary}>→ {stats().columns} columns</text>
        <Show when={stats().rows > 0}>
          <text fg={theme.warning}>▒ {stats().rows} rows</text>
        </Show>
        <Show when={stats().pks > 0}>
          <text fg={theme.textMuted}>⚿ {stats().pks} with PK</text>
        </Show>
      </box>

      <scrollbox height="100%">
        <box flexDirection="column" gap={0}>
          <text fg={theme.text}>{renderedContent()}</text>
        </box>
      </scrollbox>
    </box>
  )
}
