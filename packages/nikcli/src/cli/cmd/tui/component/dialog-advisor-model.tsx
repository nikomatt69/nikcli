import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { type DialogContext } from "@tui/ui/dialog"
import { entries, filter, flatMap, map, pipe, sortBy } from "remeda"

export function DialogAdvisorModel(props: { agentName: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const currentAdvisor = createMemo(() => {
    const agent = sync.data.agent.find((x) => x.name === props.agentName)
    return (agent as any)?.advisor?.model as { providerID: string; modelID: string } | undefined
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const clearOptions: DialogSelectOption<string>[] = currentAdvisor()
      ? [
          {
            value: "__clear__",
            title: "Clear advisor",
            description: "Remove advisor from this agent",
            category: "Action",
            onSelect: (ctx: DialogContext) => {
              sdk.client.config
                .update({
                  config: { agent: { [props.agentName]: { advisor: null, advisor_max_uses: null } } } as any,
                })
                .then(({ error }) => {
                  if (error) {
                    toast.show({
                      message: `Failed to clear advisor: ${(error as any).message ?? error}`,
                      variant: "error",
                    })
                    return
                  }
                  toast.show({ message: "Advisor cleared", variant: "success" })
                  ctx.clear()
                })
            },
          },
        ]
      : []

    const modelOptions: DialogSelectOption<string>[] = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "nikcli",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          map(([modelID, info]): DialogSelectOption<string> => {
            const providerID = provider.id
            const isCurrent = currentAdvisor()?.providerID === providerID && currentAdvisor()?.modelID === modelID
            return {
              value: `${providerID}/${modelID}`,
              title: info.name ?? modelID,
              description: isCurrent ? "(current advisor)" : undefined,
              category: provider.name,
              onSelect: (ctx: DialogContext) => {
                sdk.client.config
                  .update({
                    config: { agent: { [props.agentName]: { advisor: `${providerID}/${modelID}` } } },
                  })
                  .then(({ error }) => {
                    if (error) {
                      toast.show({
                        message: `Failed to set advisor: ${(error as any).message ?? error}`,
                        variant: "error",
                      })
                      return
                    }
                    toast.show({ message: `Advisor set to ${info.name ?? modelID}`, variant: "success" })
                    ctx.clear()
                  })
              },
            }
          }),
        ),
      ),
    )

    return [...clearOptions, ...modelOptions]
  })

  const current = createMemo(() => {
    const a = currentAdvisor()
    return a ? `${a.providerID}/${a.modelID}` : undefined
  })

  return <DialogSelect title={`Set advisor · ${props.agentName}`} current={current()} options={options()} />
}
