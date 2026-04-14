import z from "zod"
import { Tool } from "./tool"
import { Provider } from "@/provider/provider"
import { generateText } from "ai"
import DESCRIPTION from "./advisor.txt"

const parameters = z.object({
  context: z
    .string()
    .describe(
      "Describe the current situation, what you have tried, and your specific question for the advisor.",
    ),
})

type AdvisorMetadata = {
  advisorModel: string
  advisorProvider: string
  usesLeft: number
}

export const AdvisorTool = Tool.define<typeof parameters, AdvisorMetadata>(
  "advisor",
  async (initCtx) => {
    const advisor = initCtx?.agent?.advisor
    if (!advisor) throw new Error("No advisor configured for this agent")

    const advisorFullModel = await Provider.getModel(advisor.model.providerID, advisor.model.modelID)
    const advisorLanguage = await Provider.getLanguage(advisorFullModel)
    const maxUses = advisor.maxUses ?? 3
    let usesLeft = maxUses

    return {
      description: DESCRIPTION,
      parameters,
      async execute({ context }, _ctx) {
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

        const result = await generateText({
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

        return {
          title: `Advisor · ${advisorFullModel.name ?? advisor.model.modelID}`,
          output: result.text,
          metadata: {
            advisorModel: advisor.model.modelID,
            advisorProvider: advisor.model.providerID,
            usesLeft,
          },
        }
      },
    }
  },
)
