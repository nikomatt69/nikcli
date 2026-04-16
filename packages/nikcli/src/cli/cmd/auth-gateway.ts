/**
 * nikcli Gateway Auth Command
 *
 * Usage: nikcli auth gateway
 */

import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { GatewayClient } from "../../auth/gateway-client"
import { spinner } from "@clack/prompts"

export namespace GatewayAuth {
  export async function login() {
    console.log("\n🔐 Starting nikcli Gateway authentication...\n")

    const s = spinner()

    try {
      // Step 1: Initiate device auth
      s.start("Initiating device authorization")
      const { code, verificationUrl, expiresIn } = await GatewayClient.initiateDeviceAuth()
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

      const approved = await GatewayClient.waitForAuth(code, expiresIn)

      s2.stop(`✓ Authenticated as ${approved.userEmail}`)

      // Step 5: Save auth. `refresh` is required by the Auth schema; until the
      // Gateway issues separate refresh/access tokens we mirror the bearer and
      // use the server-reported `expiresAt` so revoked tokens surface quickly.
      await Auth.set("nikcli", {
        type: "oauth",
        refresh: approved.token,
        access: approved.token,
        expires: approved.expiresAt,
        ...(approved.accountId ? { accountId: approved.accountId } : {}),
      })

      console.log("\n✅ Successfully authenticated with nikcli Gateway!\n")

      // Step 6: Print useful info
      const config = await Config.get()
      console.log("📊 Profile:")
      console.log(`   Email: ${approved.userEmail}`)
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
      const remaining = Math.max(0, auth.expires - Date.now())
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000))
      const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
      console.log(`   Expires in: ${days}d ${hours}h\n`)
    } else if (auth.type === "api") {
      console.log("\n🔐 Logged in to nikcli Gateway (API Key)")
      console.log(`   Key: ${auth.key.substring(0, 20)}...\n`)
    }
  }

  /**
   * Lightweight reachability probe for the Gateway. Uses a GET against the
   * device-auth endpoint with a known-bad code so the server returns a fast
   * 403/404/410 without allocating a real, approvable authorization slot.
   */
  export async function test() {
    console.log("\n🧪 Testing nikcli Gateway connection...\n")

    try {
      const probeUrl = `${GatewayClient.apiBase()}/api/device-auth/codes/__probe__`
      const response = await fetch(probeUrl, { method: "GET" })

      // 403/410 indicate the endpoint is alive and rejecting an unknown code.
      // 2xx would be unexpected (the probe code should never exist) but still
      // proves connectivity. 5xx or network failure indicates the Gateway is
      // unreachable.
      if (response.status >= 200 && response.status < 500) {
        console.log(`   ✅ Gateway reachable (status ${response.status})`)
      } else {
        console.log(`   ⚠️  Gateway returned ${response.status}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`   ❌ Connection failed: ${message}`)
    }

    console.log("")
  }

  export async function devApprove(code: string) {
    try {
      await GatewayClient.approveDeviceAuth(code)
      console.log(`\n✅ Code ${code} approved\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`\n❌ Failed to approve code ${code}: ${message}\n`)
      process.exit(1)
    }
  }
}
