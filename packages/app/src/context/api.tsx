import { createContext, useContext, createMemo, type JSX } from "solid-js"
import { createNikcliClient, type NikcliClient } from "@nikcli-ai/sdk/v2"
import { NIKCLI_DIRECTORY, NIKCLI_URL } from "../lib/constants"
import { useAuth } from "./auth"

interface ApiContextValue {
  baseUrl: () => string
  directory: () => string | undefined
  auth: () => string | null
  sdk: () => NikcliClient
}

export const ApiContext = createContext<ApiContextValue>()

export function ApiProvider(props: { children: JSX.Element }) {
  const { token } = useAuth()

  const baseUrl = () => NIKCLI_URL
  const directory = () => (NIKCLI_DIRECTORY ? NIKCLI_DIRECTORY : undefined)
  const auth = () => token()

  const sdk = createMemo(() => {
    const header = token()
    const headers = header ? { Authorization: header } : undefined
    return createNikcliClient({ baseUrl: baseUrl(), headers, directory: directory() })
  })

  return <ApiContext.Provider value={{ baseUrl, directory, auth, sdk }}>{props.children}</ApiContext.Provider>
}

export function useApi() {
  const context = useContext(ApiContext)
  if (!context) {
    throw new Error("useApi must be used within ApiProvider")
  }
  return context
}
