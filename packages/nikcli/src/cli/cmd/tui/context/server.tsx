import { createSimpleContext } from "./helper"
import type { MobileAuthTokenPublic } from "@nikcli-ai/sdk/httpapi"

export type StartServerOptions = {
  hostname?: string
  port?: number
  mdns?: boolean
  mobileAuthRequired?: boolean
}

export type CreateMobileTokenOptions = {
  name?: string
  expiresInDays?: number
}

export type CreatedMobileToken = {
  token: string
  info: MobileAuthTokenPublic
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (input: {
    startServer?: (options?: StartServerOptions) => Promise<string>
    createMobileToken?: (options?: CreateMobileTokenOptions) => Promise<CreatedMobileToken>
  }) => ({
    startServer: input.startServer,
    createMobileToken: input.createMobileToken,
  }),
})
