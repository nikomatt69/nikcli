/**
 * nikcli Gateway Auth Command
 *
 * Usage: nikcli auth gateway
 */

import { Auth } from "../../auth"
import { Command } from "../../command"
import { Config } from "../../config/config"
import { Log } from "../../util/log"
import { spinner } from "@clack/prompts"

const log = Log.create({ service: "auth.gateway" })

interface DeviceAuthInitResponse {
  code: string
  verificationUrl: string
  expiresIn: number
}

interface DeviceAuthPollResponse {
  status: "pending" | "approved" | "denied" | "expired"
  token?: string
  userEmail?: string
}

async function initiateDeviceAuth(): Promise<DeviceAuthInitResponse> {
  const apiBase = process.env.NIKCLI_API_URL || "https://api.nikcli.ai"

  const response = await fetch(`${apiBase}/api/device-auth/codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Too many pending authorization requests. Please try again later.")
    }
    throw new Error(`Failed to initiate device authorization: ${response.status}`)
  }

  return response.json()
}

async function pollDeviceAuth(code: string): Promise<DeviceAuthPollResponse> {
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
    throw new Error(`Failed to poll device authorization: ${response.status}`)
  }

  return response.json()
}

async function waitForAuth(code: string, expiresIn: number): Promise<DeviceAuthPollResponse> {
  const pollInterval = 3000
  const maxAttempts = Math.ceil((expiresIn * 1000) / pollInterval)
  const startTime = Date.now()

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await pollDeviceAuth(code)

    if (result.status === "approved") {
      return result
    }

    if (result.status === "denied") {
      throw new Error("Authorization denied by user")
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

async function approveDeviceAuth(code: string): Promise<void> {
  const apiBase = process.env.NIKCLI_API_URL || "https://api.nikcli.ai"

  await fetch(`${apiBase}/api/device-auth/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  })
}

export namespace GatewayAuth {
  export async function login() {
    console.log("\n🔐 Starting nikcli Gateway authentication...\n")

    const s = spinner()

    try {
      // Step 1: Initiate device auth
      s.start("Initiating device authorization")
      const { code, verificationUrl, expiresIn } = await initiateDeviceAuth()
      s.stop("Device authorization initiated")

      // Step 2: Display instructions
      console.log("\n📋 Verification Details:")
      console.log(`   URL: ${verificationUrl}`)
      console.log(`   Code: ${code}`)
      console.log(`   Expires: ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}\n`)

      // Step 3: Open browser
      console.log("🌐 Opening browser for authentication...")
      try {
        const { default: open } = await import("open")
        await open(verificationUrl)
      } catch {
        console.log("Please open this URL in your browser:")
        console.log(`   ${verificationUrl}\n`)
      }

      // Step 4: Poll for authorization
      const s2 = spinner()
      s2.start("Waiting for authorization")

      const result = await waitForAuth(code, expiresIn)

      if (!result.token || !result.userEmail) {
        s2.stop("Authentication failed")
        throw new Error("Invalid response from authorization server")
      }

      s2.stop(`✓ Authenticated as ${result.userEmail}`)

      // Step 5: Save auth
      await Auth.set("nikcli", {
        type: "oauth",
        refresh: result.token,
        access: result.token,
        expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
      })

      console.log("\n✅ Successfully authenticated with nikcli Gateway!\n")

      // Step 6: Print useful info
      const config = await Config.get()
      console.log("📊 Profile:")
      console.log(`   Email: ${result.userEmail}`)
      console.log(`   Provider: nikcli`)

      if (config.provider?.["nikcli"]) {
        console.log("\n⚠️  Provider 'nikcli' already configured in nikcli.json")
        console.log("   Add models to use nikcli Gateway:")
        console.log('   "provider": { "nikcli": { "models": { ... } } }')
      } else {
        console.log("\n📝 Next steps:")
        console.log("   1. Configure models in nikcli.json (optional)")
        console.log("   2. Run 'nikcli models' to see available models")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`\n❌ Authentication failed: ${message}\n`)
      process.exit(1)
    }
  }

  export async function logout() {
    await Auth.remove("nikcli")
    console.log("\n✅ Logged out from nikcli Gateway\n")
  }

  export async function status() {
    const auth = await Auth.get("nikcli")

    if (!auth) {
      console.log("\n🔓 Not logged in to nikcli Gateway\n")
      return
    }

    if (auth.type === "oauth") {
      console.log("\n🔐 Logged in to nikcli Gateway")
      console.log(`   Token: ${auth.access.substring(0, 20)}...`)
      if (auth.accountId) {
        console.log(`   Organization: ${auth.accountId}`)
      }
      const expiresIn = Math.max(0, auth.expires - Date.now())
      const days = Math.floor(expiresIn / (24 * 60 * 60 * 1000))
      console.log(`   Expires: ${days} days\n`)
    } else if (auth.type === "api") {
      console.log("\n🔐 Logged in to nikcli Gateway (API Key)")
      console.log(`   Key: ${auth.key.substring(0, 20)}...\n`)
    }
  }

  export async function test() {
    console.log("\n🧪 Testing nikcli Gateway connection...\n")

    try {
      // Test 1: Device auth endpoint
      console.log("Testing device auth endpoint...")
      const response = await fetch(`${process.env.NIKCLI_API_URL || "https://api.nikcli.ai"}/api/device-auth/codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (response.ok) {
        const data = await response.json()
        console.log(`   ✅ Device auth works (code: ${data.code})`)
      } else {
        console.log(`   ⚠️  Device auth returned ${response.status}`)
      }
    } catch (error) {
      console.log(`   ❌ Connection failed: ${error}`)
    }

    console.log("")
  }

  export async function devApprove(code: string) {
    // Development helper - approve a device auth code
    await approveDeviceAuth(code)
    console.log(`\n✅ Code ${code} approved\n`)
  }
}
