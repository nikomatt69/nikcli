/* @refresh reload */
import { render } from "solid-js/web"
import { Router, Route, A, Navigate, useLocation } from "@solidjs/router"
import { lazy } from "solid-js"
import "./styles.css"

const McpPage = lazy(() => import("./pages/mcp").then((m) => ({ default: m.McpPage })))
const ProfilesPage = lazy(() => import("./pages/profiles").then((m) => ({ default: m.ProfilesPage })))
const SkillsPage = lazy(() => import("./pages/skills").then((m) => ({ default: m.SkillsPage })))
const PluginsPage = lazy(() => import("./pages/plugins").then((m) => ({ default: m.PluginsPage })))
const AgentsPage = lazy(() => import("./pages/agents").then((m) => ({ default: m.AgentsPage })))
const CommandsPage = lazy(() => import("./pages/commands").then((m) => ({ default: m.CommandsPage })))
const AuthPage = lazy(() => import("./pages/auth").then((m) => ({ default: m.AuthPage })))
const BackupPage = lazy(() => import("./pages/backup").then((m) => ({ default: m.BackupPage })))
const SettingsPage = lazy(() => import("./pages/settings").then((m) => ({ default: m.SettingsPage })))
const UsersPage = lazy(() => import("./pages/users").then((m) => ({ default: m.UsersPage })))

const NAV = [
  { path: "/studio/mcp",      label: "MCP Servers", icon: "⚡" },
  { path: "/studio/profiles", label: "Profiles",    icon: "👤" },
  { path: "/studio/skills",   label: "Skills",      icon: "🧠" },
  { path: "/studio/plugins",  label: "Plugins",     icon: "🔌" },
  { path: "/studio/agents",   label: "Agents",      icon: "🤖" },
  { path: "/studio/commands", label: "Commands",    icon: "⌘"  },
  { path: "/studio/auth",     label: "Auth",        icon: "🔑" },
  { path: "/studio/users",    label: "Users",       icon: "👥" },
  { path: "/studio/backup",   label: "Backup",      icon: "💾" },
  { path: "/studio/settings", label: "Settings",    icon: "⚙️" },
]

function Sidebar() {
  const location = useLocation()
  return (
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="logo-icon">N</div>
        <div class="logo-text">nikcli<br /><span>Studio</span></div>
      </div>
      <nav class="sidebar-nav">
        {NAV.map((item) => (
          <A
            href={item.path}
            class={`nav-item${location.pathname === item.path ? " active" : ""}`}
          >
            <span class="nav-icon">{item.icon}</span>
            <span class="nav-label">{item.label}</span>
          </A>
        ))}
      </nav>
    </aside>
  )
}

function App() {
  return (
    <Router>
      <div class="app">
        <Sidebar />
        <main class="main-content">
          <Route path="/studio" component={() => <Navigate href="/studio/mcp" />} />
          <Route path="/studio/mcp" component={McpPage} />
          <Route path="/studio/profiles" component={ProfilesPage} />
          <Route path="/studio/skills" component={SkillsPage} />
          <Route path="/studio/plugins" component={PluginsPage} />
          <Route path="/studio/agents" component={AgentsPage} />
          <Route path="/studio/commands" component={CommandsPage} />
          <Route path="/studio/auth" component={AuthPage} />
          <Route path="/studio/users" component={UsersPage} />
          <Route path="/studio/backup" component={BackupPage} />
          <Route path="/studio/settings" component={SettingsPage} />
          <Route path="*" component={() => <Navigate href="/studio/mcp" />} />
        </main>
      </div>
    </Router>
  )
}

render(() => <App />, document.getElementById("root")!)
