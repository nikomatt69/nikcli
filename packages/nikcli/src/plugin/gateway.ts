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
import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "plugin.gateway" })

// ============================================================================
// Device Authorization Flow
// ============================================================================

interface DeviceAuthResult {
  type: "success"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

async function initiateDeviceAuth(): Promise<{ code: string; verificationUrl: string; expiresIn: number }> {
  const apiBase = process.env.NIKCLI_API_URL || "https://api.nikcli.ai"

  const response = await fetch(`${apiBase}/api/device-auth/codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })

  if (!response.ok) {
    throw new Error(`Failed to initiate device auth: ${response.status}`)
  }

  return response.json()
}

async function pollDeviceAuth(code: string): Promise<{ status: string; token?: string; userEmail?: string }> {
  const apiBase = process.env.NIKCLI_API_URL || "https://api.nikcli.ai"

  const response = await fetch(`${apiBase}/api/device-auth/codes/${code}`)

  if (response.status === 202) {
    return { status: "pending" }
  }

  if (response.status === 403) {
    return { status: "denied" }
  }

  if (response.status === 410) {
    return { status: "expired" }
  }

  if (!response.ok) {
    throw new Error(`Failed to poll device auth: ${response.status}`)
  }

  return response.json()
}

async function waitForAuth(code: string, expiresIn: number): Promise<DeviceAuthResult> {
  const pollInterval = 3000 // 3 seconds
  const maxAttempts = Math.ceil((expiresIn * 1000) / pollInterval)
  const startTime = Date.now()

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await pollDeviceAuth(code)

    if (result.status === "approved" && result.token) {
      return {
        type: "success",
        refresh: result.token, // In production, separate refresh token
        access: result.token,
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
        accountId: undefined,
      }
    }

    if (result.status === "denied") {
      throw new Error("Authorization denied")
    }

    if (result.status === "expired") {
      throw new Error("Authorization code expired")
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }
  }

  throw new Error("Authorization timed out")
}

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
            console.log("\n🔐 Starting nikcli Gateway authentication...\n")

            try {
              const { code, verificationUrl, expiresIn } = await initiateDeviceAuth()

              console.log("📋 Verification Details:")
              console.log(`   URL: ${verificationUrl}`)
              console.log(`   Code: ${code}`)
              console.log(`   Expires: ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}\n`)

              // Open browser
              try {
                const { default: open } = await import("open")
                await open(verificationUrl)
              } catch {
                console.log("Please open this URL in your browser:")
                console.log(`   ${verificationUrl}\n`)
              }

              // Wait for authorization
              console.log("⏳ Waiting for authorization...")
              const result = await waitForAuth(code, expiresIn)

              console.log(`\n✅ Authenticated successfully!\n`)

              return {
                url: verificationUrl,
                instructions: `Authorization code: ${code}`,
                method: "code",
                async callback(_code: string) {
                  return result
                },
              }
            } catch (error) {
              console.error(`\n❌ Authentication failed: ${error}\n`)
              throw error
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
