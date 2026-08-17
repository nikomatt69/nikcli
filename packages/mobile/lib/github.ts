import type { MobileClient } from "@/lib/client"
import type { GitHubDeviceAuthStart } from "@/lib/types"

/** Public nikcli GitHub App client ID (not a secret). */
export const NIKCLI_GITHUB_OAUTH_CLIENT_ID = "Iv23liviwaSQK4HZ0qkl"

const HOST_CLIENT_ID_MISSING = /github oauth client id is not configured/i

export async function startGithubDeviceAuthWithHostDefault(
  client: Pick<MobileClient, "saveGithubOAuthClientID" | "startGithubDeviceAuth">,
  oauthConfigured: boolean,
): Promise<GitHubDeviceAuthStart> {
  if (!oauthConfigured) {
    await client.saveGithubOAuthClientID(NIKCLI_GITHUB_OAUTH_CLIENT_ID)
  }
  try {
    return await client.startGithubDeviceAuth()
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (!HOST_CLIENT_ID_MISSING.test(text)) throw error
    await client.saveGithubOAuthClientID(NIKCLI_GITHUB_OAUTH_CLIENT_ID)
    return await client.startGithubDeviceAuth()
  }
}
