/* eslint-disable */
import * as Router from "expo-router"

export * from "expo-router"

declare module "expo-router" {
  export namespace ExpoRouter {
    export interface __routes<T extends string | object = string> {
      hrefInputParams:
        | { pathname: Router.RelativePathString; params?: Router.UnknownInputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownInputParams }
        | { pathname: `/connect`; params?: Router.UnknownInputParams }
        | { pathname: `/`; params?: Router.UnknownInputParams }
        | { pathname: `/login`; params?: Router.UnknownInputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/loops` | `/loops`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/repos` | `/repos`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/routines` | `/routines`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/sessions/editor` | `/sessions/editor`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/sessions/explorer` | `/sessions/explorer`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/sessions` | `/sessions`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/agents` | `/settings/agents`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/commands` | `/settings/commands`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/connectors` | `/settings/connectors`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/github` | `/settings/github`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings` | `/settings`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/mcp` | `/settings/mcp`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/memories` | `/settings/memories`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/providers` | `/settings/providers`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/skills` | `/settings/skills`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/tokens` | `/settings/tokens`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/plugins` | `/settings/plugins`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/terminal` | `/terminal`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/user` | `/user`; params?: Router.UnknownInputParams }
        | { pathname: `/+not-found`; params: Router.UnknownInputParams & {} }
        | {
            pathname: `${"/(app)"}/loops/[loopId]` | `/loops/[loopId]`
            params: Router.UnknownInputParams & { loopId: string | number }
          }
        | {
            pathname: `${"/(app)"}/routines/[routineId]` | `/routines/[routineId]`
            params: Router.UnknownInputParams & { routineId: string | number }
          }
        | {
            pathname: `${"/(app)"}/sessions/[sessionId]` | `/sessions/[sessionId]`
            params: Router.UnknownInputParams & { sessionId: string | number }
          }
      hrefOutputParams:
        | { pathname: Router.RelativePathString; params?: Router.UnknownOutputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownOutputParams }
        | { pathname: `/connect`; params?: Router.UnknownOutputParams }
        | { pathname: `/`; params?: Router.UnknownOutputParams }
        | { pathname: `/login`; params?: Router.UnknownOutputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/loops` | `/loops`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/repos` | `/repos`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/routines` | `/routines`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/sessions/editor` | `/sessions/editor`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/sessions/explorer` | `/sessions/explorer`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/sessions` | `/sessions`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/agents` | `/settings/agents`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/commands` | `/settings/commands`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/connectors` | `/settings/connectors`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/github` | `/settings/github`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings` | `/settings`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/mcp` | `/settings/mcp`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/memories` | `/settings/memories`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/providers` | `/settings/providers`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/skills` | `/settings/skills`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/tokens` | `/settings/tokens`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/settings/plugins` | `/settings/plugins`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/terminal` | `/terminal`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(app)"}/user` | `/user`; params?: Router.UnknownOutputParams }
        | { pathname: `/+not-found`; params: Router.UnknownOutputParams & {} }
        | {
            pathname: `${"/(app)"}/loops/[loopId]` | `/loops/[loopId]`
            params: Router.UnknownOutputParams & { loopId: string }
          }
        | {
            pathname: `${"/(app)"}/routines/[routineId]` | `/routines/[routineId]`
            params: Router.UnknownOutputParams & { routineId: string }
          }
        | {
            pathname: `${"/(app)"}/sessions/[sessionId]` | `/sessions/[sessionId]`
            params: Router.UnknownOutputParams & { sessionId: string }
          }
      href:
        | Router.RelativePathString
        | Router.ExternalPathString
        | `/connect${`?${string}` | `#${string}` | ""}`
        | `/${`?${string}` | `#${string}` | ""}`
        | `/login${`?${string}` | `#${string}` | ""}`
        | `/_sitemap${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/loops${`?${string}` | `#${string}` | ""}`
        | `/loops${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/repos${`?${string}` | `#${string}` | ""}`
        | `/repos${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/routines${`?${string}` | `#${string}` | ""}`
        | `/routines${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/sessions/editor${`?${string}` | `#${string}` | ""}`
        | `/sessions/editor${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/sessions/explorer${`?${string}` | `#${string}` | ""}`
        | `/sessions/explorer${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/sessions${`?${string}` | `#${string}` | ""}`
        | `/sessions${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/agents${`?${string}` | `#${string}` | ""}`
        | `/settings/agents${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/commands${`?${string}` | `#${string}` | ""}`
        | `/settings/commands${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/connectors${`?${string}` | `#${string}` | ""}`
        | `/settings/connectors${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/github${`?${string}` | `#${string}` | ""}`
        | `/settings/github${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings${`?${string}` | `#${string}` | ""}`
        | `/settings${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/mcp${`?${string}` | `#${string}` | ""}`
        | `/settings/mcp${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/memories${`?${string}` | `#${string}` | ""}`
        | `/settings/memories${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/providers${`?${string}` | `#${string}` | ""}`
        | `/settings/providers${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/skills${`?${string}` | `#${string}` | ""}`
        | `/settings/skills${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/tokens${`?${string}` | `#${string}` | ""}`
        | `/settings/tokens${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/settings/plugins${`?${string}` | `#${string}` | ""}`
        | `/settings/plugins${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/terminal${`?${string}` | `#${string}` | ""}`
        | `/terminal${`?${string}` | `#${string}` | ""}`
        | `${"/(app)"}/user${`?${string}` | `#${string}` | ""}`
        | `/user${`?${string}` | `#${string}` | ""}`
        | { pathname: Router.RelativePathString; params?: Router.UnknownInputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownInputParams }
        | { pathname: `/connect`; params?: Router.UnknownInputParams }
        | { pathname: `/`; params?: Router.UnknownInputParams }
        | { pathname: `/login`; params?: Router.UnknownInputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/loops` | `/loops`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/repos` | `/repos`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/routines` | `/routines`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/sessions/editor` | `/sessions/editor`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/sessions/explorer` | `/sessions/explorer`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/sessions` | `/sessions`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/agents` | `/settings/agents`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/commands` | `/settings/commands`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/connectors` | `/settings/connectors`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/github` | `/settings/github`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings` | `/settings`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/mcp` | `/settings/mcp`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/memories` | `/settings/memories`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/providers` | `/settings/providers`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/skills` | `/settings/skills`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/tokens` | `/settings/tokens`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/settings/plugins` | `/settings/plugins`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/terminal` | `/terminal`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(app)"}/user` | `/user`; params?: Router.UnknownInputParams }
        | `/+not-found`
        | `${"/(app)"}/loops/${Router.SingleRoutePart<T>}`
        | `/loops/${Router.SingleRoutePart<T>}`
        | `${"/(app)"}/routines/${Router.SingleRoutePart<T>}`
        | `/routines/${Router.SingleRoutePart<T>}`
        | `${"/(app)"}/sessions/${Router.SingleRoutePart<T>}`
        | `/sessions/${Router.SingleRoutePart<T>}`
        | { pathname: `/+not-found`; params: Router.UnknownInputParams & {} }
        | {
            pathname: `${"/(app)"}/loops/[loopId]` | `/loops/[loopId]`
            params: Router.UnknownInputParams & { loopId: string | number }
          }
        | {
            pathname: `${"/(app)"}/routines/[routineId]` | `/routines/[routineId]`
            params: Router.UnknownInputParams & { routineId: string | number }
          }
        | {
            pathname: `${"/(app)"}/sessions/[sessionId]` | `/sessions/[sessionId]`
            params: Router.UnknownInputParams & { sessionId: string | number }
          }
    }
  }
}
