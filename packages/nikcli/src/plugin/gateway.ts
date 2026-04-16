/**
 * nikcli Gateway Plugin
 *
 * Provides:
 * - OAuth authentication via device authorization flow
 * - API key authentication
 * - Profile/balance fetching
 * - Organization management
 */

import type { Hooks, PluginInput, Plugin as PluginType } from "@nikcli-ai/plugin"
import type { Auth as SdkAuth } from "@nikcli-ai/sdk"
import { GatewayClient } from "../auth/gateway-client"

// ============================================================================
// Plugin
// ============================================================================

export const NikcliGatewayPlugin: PluginType = async (_input: PluginInput, _options?: any): Promise<Hooks> => {
  return {
    auth: {
      provider: "nikcli",
      async loader(getAuth, _provider) {
        const auth: SdkAuth | null = await getAuth()
        if (!auth) return {}

        if (auth.type === "api") {
          return { nikcliToken: auth.key }
        }

        if (auth.type === "oauth") {
          // accountId is optional on OAuth type from SDK
          const accountId = (auth as any).accountId as string | undefined
          return {
            nikcliToken: auth.access,
            ...(accountId && { nikcliOrganizationId: accountId }),
          }
        }

        return {}
      },
      methods: [
        {
          type: "oauth",
          label: "nikcli Gateway",
          async authorize() {
            // Kick off a device-auth session synchronously so the SDK can show
            // the verification URL + code immediately. Actual polling runs
            // inside `callback()` so the SDK's auth runner controls its
            // lifecycle (cancel, UI updates, retry, etc.).
            const { code, verificationUrl, expiresIn } = await GatewayClient.initiateDeviceAuth()

            return {
              url: verificationUrl,
              instructions: `Visit ${verificationUrl} and enter code: ${code}`,
              method: "auto",
              async callback() {
                try {
                  const approved = await GatewayClient.waitForAuth(code, expiresIn)
                  return {
                    type: "success",
                    refresh: approved.token,
                    access: approved.token,
                    expires: approved.expiresAt,
                    ...(approved.accountId ? { accountId: approved.accountId } : {}),
                  }
                } catch {
                  return { type: "failed" }
                }
              },
            }
          },
        },
        {
          type: "api",
          label: "nikcli API Key",
          prompts: [
            {
              type: "text",
              key: "apiKey",
              message: "Enter your nikcli API key:",
              placeholder: "nik_xxxxxxxxxxxx",
            },
          ],
          async authorize(inputs) {
            const apiKey = inputs?.apiKey
            if (!apiKey) {
              return { type: "failed" }
            }

            // Validate API key format
            if (!apiKey.startsWith("nik_")) {
              return { type: "failed" }
            }

            return {
              type: "success",
              key: apiKey,
            }
          },
        },
      ],
    },
  }
}

export default NikcliGatewayPlugin
