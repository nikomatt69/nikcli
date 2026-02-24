import { createSimpleContext } from "./helper"

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (input: { startServer?: () => Promise<string> }) => ({
    startServer: input.startServer,
  }),
})
