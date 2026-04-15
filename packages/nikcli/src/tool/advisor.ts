import z from "zod"
import { Tool } from "./tool"
import { Provider } from "@/provider/provider"
import { generateText } from "ai"
import DESCRIPTION from "./advisor.txt"
import { Delegation } from "@/delegation/manager"

const parameters = z.object({
  context: z
    .string()
    .describe("Describe the current situation, what you have tried, and your specific question for the advisor."),
})

type AdvisorMetadata = {
  advisorModel: string
  advisorProvider: string
  usesLeft: number
  delegationId?: string
}

export const AdvisorTool = Tool.define<typeof parameters, AdvisorMetadata>("advisor", async (initCtx) => {
  const advisor = initCtx?.agent?.advisor
  if (!advisor) throw new Error("No advisor configured for this agent")

  const advisorFullModel = await Provider.getModel(advisor.model.providerID, advisor.model.modelID)
  const advisorLanguage = await Provider.getLanguage(advisorFullModel)
  const maxUses = advisor.maxUses ?? 3
  let usesLeft = maxUses

  return {
    description: DESCRIPTION,
    parameters,
    async execute({ context }, ctx) {
      if (usesLeft <= 0) {
        return {
          title: "Advisor (limit reached)",
          output: "Advisor usage limit reached. Proceed with your best judgment.",
          metadata: {
            advisorModel: advisor.model.modelID,
            advisorProvider: advisor.model.providerID,
            usesLeft: 0,
          },
        }
      }

      usesLeft--

      const modelLabel = advisorFullModel.name ?? advisor.model.modelID

      const delegation = await Delegation.create({
        parentSessionID: ctx.sessionID,
        agent: `advisor:${advisor.model.modelID}`,
        prompt: context,
        source: "advisor",
      })

      ctx.metadata({
        title: `Advisor · ${modelLabel}`,
        metadata: {
          advisorModel: advisor.model.modelID,
          advisorProvider: advisor.model.providerID,
          usesLeft,
          delegationId: delegation.id,
        },
      })

      void generateText({
        model: advisorLanguage,
        maxOutputTokens: 2048,
        messages: [
          {
            role: "system",
            content:
              "You are a strategic advisor to an AI coding assistant. Provide concise, actionable guidance. Do not execute tools or produce user-facing output — return only a clear plan or recommendation.",
          },
          { role: "user", content: context },
        ],
      })
        .then(async (result) => {
          await Delegation.finalize(delegation.id, "complete", result.text)
        })
        .catch(async (error) => {
          await Delegation.finalize(delegation.id, "error", "", error instanceof Error ? error.message : String(error))
        })

      return {
        title: `Advisor · ${modelLabel}`,
        output: [
          `Advisory request dispatched in background.`,
          `Continue your work and use \`delegation read ${delegation.id}\` when you need the guidance.`,
          ``,
          `<advisor_metadata>`,
          `delegation_id: ${delegation.id}`,
          `uses_left: ${usesLeft}`,
          `</advisor_metadata>`,
        ].join("\n"),
        metadata: {
          advisorModel: advisor.model.modelID,
          advisorProvider: advisor.model.providerID,
          usesLeft,
          delegationId: delegation.id,
        },
      }
    },
  }
})
