import { Config } from "../config/config"
import { Flag } from "@nikcli-ai/util/flag"
import { getToken as getFigmaToken } from "./api/figma"
import { getToken as getGithubToken } from "./api/github"
import { getBotToken as getSlackBotToken } from "./api/slack"
import { getToken as getLovableToken } from "./api/lovable"

type CredentialType = "token" | "botToken" | "apiKey"

const credentialTypeMap: Record<string, CredentialType> = {
  figma: "token",
  github: "token",
  slack: "botToken",
  lovable: "token",
}

function getCredentialType(type: string): CredentialType | null {
  return credentialTypeMap[type] ?? null
}

function getCredentialFlag(type: string): string | null {
  switch (type) {
    case "figma":
      return Flag.NIKCLI_FIGMA_TOKEN ?? null
    case "github":
      return Flag.NIKCLI_GITHUB_TOKEN ?? null
    case "slack":
      return Flag.NIKCLI_SLACK_BOT_TOKEN ?? null
    case "lovable":
      return Flag.NIKCLI_LOVABLE_TOKEN ?? null
    default:
      return null
  }
}

function getCredentialFromAuth(name: string, type: string): Promise<string | null> {
  switch (type) {
    case "figma":
      return getFigmaToken(name)
    case "github":
      return getGithubToken(name)
    case "slack":
      return getSlackBotToken(name)
    case "lovable":
      return getLovableToken(name)
    default:
      return Promise.resolve(null)
  }
}

function getCredentialFromConfig(connector: Config.Connector): string | null {
  switch (connector.type) {
    case "figma":
      return connector.token ?? null
    case "github":
      return connector.token ?? null
    case "slack":
      return connector.botToken ?? null
    case "lovable":
      return connector.token ?? connector.apiKey ?? null
    default:
      return null
  }
}

export async function resolveCredential(name: string, connector: Config.Connector): Promise<string | null> {
  const flag = getCredentialFlag(connector.type)
  if (flag) return flag

  const configCredential = getCredentialFromConfig(connector)
  if (configCredential) return configCredential

  const authCredential = await getCredentialFromAuth(name, connector.type)
  if (authCredential) return authCredential

  return null
}

export function resolveCredentialType(type: string): CredentialType | null {
  return getCredentialType(type)
}
