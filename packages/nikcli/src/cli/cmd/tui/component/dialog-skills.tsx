import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createResource, createMemo } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"

export function DialogSkills() {
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()

  const [skills] = createResource(async () => {
    const result = await sdk.client.app.skills()
    return result.data ?? []
  })

  const options = createMemo(() => {
    const skillList = skills() ?? []
    return skillList.map((skill) => ({
      title: skill.name,
      description: skill.description,
      value: skill.name,
      footer: skill.location,
    }))
  })

  return (
    <DialogSelect
      title="Skills"
      options={options()}
      skipFilter={false}
      onSelect={(option) => {
        if (route.data.type === "session") {
          route.navigate({
            type: "session",
            sessionID: route.data.sessionID,
            initialPrompt: { input: `/skill ${option.value}`, parts: [] },
          })
        } else {
          route.navigate({
            type: "home",
            initialPrompt: { input: `/skill ${option.value}`, parts: [] },
          })
        }
        dialog.clear()
      }}
    />
  )
}
