import type { Provider } from "@/provider/provider"

export const EventError = {
  unknown: (message: string) => ({ name: "UnknownError" as const, data: { message } }),

  agentNotFound: (agent: string, available: string[]) => ({
    name: "AgentNotFoundError" as const,
    data: { agent, available },
  }),

  commandNotFound: (command: string, available: string[]) => ({
    name: "CommandNotFoundError" as const,
    data: { command, available },
  }),

  modelNotFound: (err: Provider.ModelNotFoundError) => ({
    name: "ProviderModelNotFoundError" as const,
    data: { providerID: err.providerID, modelID: err.modelID, suggestions: err.suggestions },
  }),
}
