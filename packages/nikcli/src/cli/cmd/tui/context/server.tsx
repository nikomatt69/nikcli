import { createSimpleContext } from "./helper"
import type { MobileAuth } from "@/mobile/auth"

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
  info: MobileAuth.PublicToken
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
