import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
  workspaceID?: string
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
  workspaceID?: string
}

export type PluginRoute = {
  type: "plugin"
  id: string
  data?: Record<string, unknown>
  workspaceID?: string
}

export type ChangesRoute = {
  type: "changes"
  sessionID: string
  workspaceID?: string
}

export type SessionTreeRoute = {
  type: "tree"
  sessionID?: string
  workspaceID?: string
}

export type GitGraphRoute = {
  type: "git-graph"
  sessionID?: string
  workspaceID?: string
}

export type GitHubRoute = {
  type: "github"
  sessionID?: string
  workspaceID?: string
}

export type Route = HomeRoute | SessionRoute | PluginRoute | ChangesRoute | SessionTreeRoute | GitGraphRoute | GitHubRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [store, setStore] = createStore<Route>(
      process.env["NIKCLI_ROUTE"]
        ? JSON.parse(process.env["NIKCLI_ROUTE"])
        : {
            type: "home",
          },
    )

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        setStore(route)
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
