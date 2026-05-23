import { createMemo, Match, Switch } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import {
  RouteOverrideProvider,
  useRoute,
  useRouteData,
  type ChangesRoute,
  type GitHubRoute,
  type RouteContext,
  type SessionTreeRoute,
} from "@tui/context/route"
import { Changes } from "@tui/routes/changes"
import { GitGraph } from "@tui/routes/git-graph"
import { GitHubPanel } from "@tui/routes/github"
import { SessionTree } from "@tui/routes/tree"
import type { GitGraphRoute } from "@tui/context/route"

type Tab = "tree" | "changes" | "graph" | "github"

const TABS: Array<{ id: Tab; label: string; key: string }> = [
  { id: "tree", label: "Sessions", key: "1" },
  { id: "changes", label: "Changes", key: "2" },
  { id: "graph", label: "Graph", key: "3" },
  { id: "github", label: "GitHub", key: "4" },
]

export function Workspace() {
  const routeData = useRouteData("workspace")
  const route = useRoute()

  const activeTab = createMemo<Tab>(() => routeData.tab ?? "tree")

  function setTab(tab: Tab) {
    route.navigate({
      type: "workspace",
      tab,
      sessionID: routeData.sessionID,
      workspaceID: routeData.workspaceID,
    })
  }

  useKeyboard((evt) => {
    if (evt.ctrl || evt.meta) return
    if (evt.name === "tab") {
      evt.preventDefault()
      const index = TABS.findIndex((t) => t.id === activeTab())
      setTab(TABS[(index + 1) % TABS.length].id)
      return
    }
    if (evt.shift && evt.name === "tab") {
      evt.preventDefault()
      const index = TABS.findIndex((t) => t.id === activeTab())
      setTab(TABS[(index - 1 + TABS.length) % TABS.length].id)
      return
    }
    for (const tab of TABS) {
      if (evt.name === tab.key) {
        evt.preventDefault()
        setTab(tab.id)
        return
      }
    }
  })

  return (
    <box flexGrow={1} flexDirection="column">
      <TabBar active={activeTab()} onSelect={setTab} />
      <box flexGrow={1}>
        <Switch>
          <Match when={activeTab() === "tree"}>
            <SubRoute
              data={{ type: "tree", sessionID: routeData.sessionID, workspaceID: routeData.workspaceID }}
              outerRoute={route}
            >
              <SessionTree />
            </SubRoute>
          </Match>
          <Match when={activeTab() === "changes"}>
            <SubRoute
              data={{
                type: "changes",
                sessionID: routeData.sessionID ?? "",
                workspaceID: routeData.workspaceID,
              }}
              outerRoute={route}
            >
              <Changes />
            </SubRoute>
          </Match>
          <Match when={activeTab() === "graph"}>
            <SubRoute
              data={{ type: "git-graph", sessionID: routeData.sessionID, workspaceID: routeData.workspaceID }}
              outerRoute={route}
            >
              <GitGraph />
            </SubRoute>
          </Match>
          <Match when={activeTab() === "github"}>
            <SubRoute
              data={{ type: "github", sessionID: routeData.sessionID, workspaceID: routeData.workspaceID }}
              outerRoute={route}
            >
              <GitHubPanel />
            </SubRoute>
          </Match>
        </Switch>
      </box>
    </box>
  )
}

function TabBar(props: { active: Tab; onSelect: (tab: Tab) => void }) {
  const { theme } = useTheme()
  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      gap={2}
      border={["bottom"]}
      borderColor={theme.borderSubtle}
    >
      {TABS.map((tab) => {
        const isActive = () => props.active === tab.id
        return (
          <box
            paddingLeft={1}
            paddingRight={1}
            onMouseDown={() => props.onSelect(tab.id)}
            backgroundColor={isActive() ? theme.backgroundElement : undefined}
          >
            <text
              fg={isActive() ? theme.text : theme.textMuted}
              attributes={isActive() ? TextAttributes.BOLD : undefined}
            >
              {tab.label}
              <span style={{ fg: theme.textMuted }}>{` ${tab.key}`}</span>
            </text>
          </box>
        )
      })}
      <box flexGrow={1} />
      <text fg={theme.textMuted}>tab · cycle · esc · back</text>
    </box>
  )
}

function SubRoute(props: {
  data: ChangesRoute | SessionTreeRoute | GitHubRoute | GitGraphRoute
  outerRoute: RouteContext
  children: any
}) {
  // Inner route value: data reflects the active tab; navigate falls back to the outer
  // workspace route so child components that call `route.navigate(...)` still escape
  // cleanly (e.g. back-to-session from <Changes />).
  const value: RouteContext = {
    get data() {
      return props.data
    },
    navigate(next) {
      props.outerRoute.navigate(next)
    },
  }
  return <RouteOverrideProvider value={value}>{props.children}</RouteOverrideProvider>
}
