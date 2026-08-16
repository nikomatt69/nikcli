/**
 * Connectors — internal TUI plugin.
 *
 * Mirrors `feature-plugins/loops`: surfaces the external-service connectors
 * (see `src/connectors/`) in the TUI as a self-contained plugin. Registers
 * the `/connectors` slash command that opens a manager listing every
 * configured connector with its live health status (connected, needs auth,
 * failed, disabled), plus per-connector actions to refresh the cached status
 * or drop stored credentials.
 *
 * Everything here goes through `api.client`. It used to lazily import the `@/connectors` module and run
 * the service in-process — lazily, because that module pulls the `ai` package chain and must not
 * be evaluated during TUI module load. Over the wire that concern disappears with the import.
 */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@nikcli-ai/plugin/tui"
import type { ConnectorStatus } from "@nikcli-ai/sdk/httpapi"

const id = "internal:connectors"

type StatusEntry = {
  name: string
  type: string
  status: ConnectorStatus
}

function statusLabel(status: ConnectorStatus): string {
  switch (status.status) {
    case "connected":
      return "● connected"
    case "needs_auth":
      return "○ needs auth"
    case "disabled":
      return "– disabled"
    case "failed":
      return `✗ failed: ${status.error}`
  }
}

async function loadStatuses(api: TuiPluginApi): Promise<StatusEntry[]> {
  const result = await api.client.connectors.status()
  const statuses = (result.data ?? {}) as Record<string, ConnectorStatus>
  const configured = (api.state.config.connectors ?? {}) as Record<string, { type?: string } | undefined>
  return Object.entries(statuses).map(([name, status]) => ({
    name,
    type: configured[name]?.type ?? "unknown",
    status,
  }))
}

/** The route drops the credential and invalidates that connector's cached status in one step. */
async function removeCredentials(api: TuiPluginApi, name: string): Promise<void> {
  await api.client.connectors.auth.remove({ name })
}

async function invalidateConnector(api: TuiPluginApi, name: string): Promise<void> {
  await api.client.connectors.invalidate({ name })
}

/** No name means "all": the handler invalidates both the status and the tool caches. */
async function invalidateAll(api: TuiPluginApi): Promise<void> {
  await api.client.connectors.invalidate({})
}

function openConnector(api: TuiPluginApi, entry: StatusEntry): void {
  const Select = api.ui.DialogSelect
  api.ui.dialog.replace(() => (
    <Select
      title={`${entry.name} · ${statusLabel(entry.status)}`}
      options={[
        {
          title: "Refresh status",
          value: "refresh",
          description: "Invalidate the cached status and re-run the health check",
          onSelect() {
            void invalidateConnector(api, entry.name).then(() => openManager(api))
          },
        },
        {
          title: "Remove credentials",
          value: "remove",
          description: "Drop the stored token for this connector",
          onSelect() {
            void removeCredentials(api, entry.name)
              .then(() => {
                api.ui.toast({ message: `Removed credentials for ${entry.name}`, variant: "success" })
                openManager(api)
              })
              .catch((error) => {
                api.ui.toast({
                  message: error instanceof Error ? error.message : "Failed to remove credentials",
                  variant: "error",
                  duration: 5000,
                })
              })
          },
        },
        {
          title: "Back",
          value: "back",
          onSelect() {
            openManager(api)
          },
        },
      ]}
    />
  ))
}

export function openManager(api: TuiPluginApi): void {
  void (async () => {
    const entries = await loadStatuses(api)
    const Select = api.ui.DialogSelect
    if (entries.length === 0) {
      const Alert = api.ui.DialogAlert
      api.ui.dialog.replace(() => (
        <Alert
          title="Connectors"
          message={'No connectors configured.\nAdd one under "connectors" in nikcli.json or run: nikcli connector add'}
        />
      ))
      return
    }
    api.ui.dialog.replace(() => (
      <Select
        title="Connectors"
        options={[
          ...entries.map((entry) => ({
            title: entry.name,
            value: entry.name,
            description: `${entry.type} · ${statusLabel(entry.status)}`,
            onSelect() {
              openConnector(api, entry)
            },
          })),
          {
            title: "Refresh all",
            value: "refresh-all",
            description: "Invalidate every cached connector status",
            onSelect() {
              void invalidateAll(api).then(() => openManager(api))
            },
          },
        ]}
      />
    ))
  })().catch((error) => {
    api.ui.toast({
      message: error instanceof Error ? error.message : "Failed to load connectors",
      variant: "error",
      duration: 5000,
    })
  })
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "connectors.manage",
        title: "Connectors",
        namespace: "System",
        description: "Inspect & manage external service connectors",
        slashName: "connectors",
        slashAliases: ["connector"],
        run() {
          openManager(api)
        },
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
