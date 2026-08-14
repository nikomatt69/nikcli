const dir = process.env.NIKCLI_E2E_PROJECT_DIR ?? process.cwd()
const title = process.env.NIKCLI_E2E_SESSION_TITLE ?? "E2E Session"
const text = process.env.NIKCLI_E2E_MESSAGE ?? "Seeded for UI e2e"
const model = process.env.NIKCLI_E2E_MODEL ?? "nikcli/gpt-5-nano"
const parts = model.split("/")
const providerID = parts[0] ?? "nikcli"
const modelID = parts[1] ?? "gpt-5-nano"
const now = Date.now()

const seed = async () => {
  const { Instance } = await import("../src/project/instance")
  const { InstanceBootstrap } = await import("../src/project/bootstrap")
  const { Session } = await import("../src/session")
  const { Identifier } = await import("@nikcli-ai/util/id")
  const { Project } = await import("../src/project/project")
  const { Effect } = await import("effect")
  const { runPromiseWithLayer, withCurrentInstance } = await import("../src/effect")

  await Instance.provide({
    directory: dir,
    init: InstanceBootstrap,
    fn: async () => {
      const session = await runPromiseWithLayer(
        Session.defaultLayer,
        withCurrentInstance(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.create({ title })
          }),
        ),
      )
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
      await runPromiseWithLayer(
        Session.defaultLayer,
        withCurrentInstance(
          Effect.gen(function* () {
            const service = yield* Session.Service
            yield* service.updateMessage(message)
            yield* service.updatePart(part)
          }),
        ),
      )
      await runPromiseWithLayer(
        Project.defaultLayer,
        Effect.gen(function* () {
          const project = yield* Project.Service
          yield* project.update({ projectID: Instance.project.id, name: "E2E Project" })
        }),
      )
    },
  })
}

await seed()
