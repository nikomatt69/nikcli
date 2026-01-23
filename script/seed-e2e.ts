const dir = process.env.NIKCLI_E2E_PROJECT_DIR ?? process.cwd()
const title = process.env.NIKCLI_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.NIKCLI_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.NIKCLI_E2E_MODEL ?? "nikcli/gpt-5-nano"
const parts = model.split("/")
const providerID = parts[0] ?? "nikcli"
const modelID = parts[1] ?? "gpt-5-nano"
const now = Date.now()

const seed = async () => {
  const { Instance } = await import("../packages/nikcli/src/project/instance")
  const { InstanceBootstrap } = await import("../packages/nikcli/src/project/bootstrap")
  const { Session } = await import("../packages/nikcli/src/session")
  const { Identifier } = await import("../packages/nikcli/src/id/id")
  const { Project } = await import("../packages/nikcli/src/project/project")

  await Instance.provide({
    directory: dir,
    init: InstanceBootstrap,
    fn: async () => {
      const session = await Session.create({ title })
      const messageID = Identifier.descending("message")
      const partID = Identifier.descending("part")
      const message = {
        id: messageID,
        sessionID: session.id,
        role: "user" as const,
        time: { created: now },
        agent: "build",
        model: {
          providerID,
          modelID,
        },
      }
      const part = {
        id: partID,
        sessionID: session.id,
        messageID,
        type: "text" as const,
        text,
        time: { start: now },
      }
      await Session.updateMessage(message)
      await Session.updatePart(part)
      await Project.update({ projectID: Instance.project.id, name: "E2E Project" })
    },
  })
}

await seed()
