import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createMemo, createResource, createSignal } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { Skill } from "@/skill"
import { Global } from "@/global"

function detectSource(location: string) {
  const normalized = location.replaceAll("\\", "/")
  const config = Global.Path.config.replaceAll("\\", "/")
  const home = Global.Path.home.replaceAll("\\", "/")

  if (normalized.includes("/.nikcli/skill/") || normalized.includes("/.nikcli/skills/")) {
    return { label: "Workspace", rank: 0 }
  }

  if (normalized.startsWith(`${config}/skills/`)) {
    return { label: "Global", rank: 1 }
  }

  if (normalized.startsWith(`${home}/.claude/`) || normalized.startsWith(`${home}/.agents/`)) {
    return { label: "External", rank: 2 }
  }

  return { label: "Other", rank: 3 }
}

function shortenLocation(location: string) {
  const normalized = location.replaceAll("\\", "/")
  const home = Global.Path.home.replaceAll("\\", "/")
  return normalized.startsWith(`${home}/`) ? `~/${normalized.slice(home.length + 1)}` : normalized
}

export function DialogSkills() {
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()
  const [filter, setFilter] = createSignal("")

  const [skills] = createResource(async () => {
    const result = await sdk.client.app.skills()
    return result.data ?? []
  })

  const options = createMemo(() => {
    const query = filter().trim().toLowerCase()

    return (skills() ?? [])
      .map((skill) => {
        const source = detectSource(skill.location)
        const metadata = [skill.category, skill.tags?.slice(0, 3).join(", "), skill.version ? `v${skill.version}` : undefined]
          .filter(Boolean)
          .join(" - ")
        const command = Skill.commandName(skill.name)
        const search = [
          skill.name,
          skill.description,
          skill.category,
          ...(skill.tags ?? []),
          skill.version,
          source.label,
          command,
          skill.location,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()

        return {
          title: skill.name,
          description: metadata ? `${skill.description} - ${metadata}` : skill.description,
          value: command,
          footer: shortenLocation(skill.location),
          category: source.label,
          rank: source.rank,
          search,
        }
      })
      .filter((skill) => !query || skill.search.includes(query))
      .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
      .map(({ rank: _rank, search: _search, ...option }) => option)
  })

  return (
    <DialogSelect
      title="Select skill"
      placeholder="Search skills, tags, source, or path"
      options={options()}
      skipFilter={true}
      onFilter={setFilter}
      onSelect={(option) => {
        if (route.data.type === "session") {
          route.navigate({
            type: "session",
            sessionID: route.data.sessionID,
            initialPrompt: { input: `/${option.value} `, parts: [] },
            workspaceID: route.data.workspaceID,
          })
        } else {
          route.navigate({
            type: "home",
            initialPrompt: { input: `/${option.value} `, parts: [] },
            workspaceID: route.data.workspaceID,
          })
        }
        dialog.clear()
      }}
    />
  )
}
