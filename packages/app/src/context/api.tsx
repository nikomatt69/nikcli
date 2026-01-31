import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface ApiContextValue {
  baseUrl: () => string
  fetch: (endpoint: string, options?: RequestInit) => Promise<Response>
}

export const ApiContext = createContext<ApiContextValue>()

export function ApiProvider(props: { children: JSX.Element }) {
  const baseUrl = () => {
    // Use API URL from env or default
    return import.meta.env.VITE_API_URL || "https://api.nikcli.store"
  }

  const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
    const url = `${baseUrl()}${endpoint}`
    return fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    })
  }

  return <ApiContext.Provider value={{ baseUrl, fetch: fetchApi }}>{props.children}</ApiContext.Provider>
}

export function useApi() {
  const context = useContext(ApiContext)
  if (!context) {
    throw new Error("useApi must be used within ApiProvider")
  }
  return context
}
