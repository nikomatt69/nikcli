import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@nikcli-ai/util/encode"
import { getFilename } from "@nikcli-ai/util/path"
import { Icon } from "@nikcli-ai/ui/icon"
import { Splash } from "@nikcli-ai/ui/logo"
import { useCommand, useGlobalSync, useLayout, usePlatform, useServer, type LocalProject } from "@nikcli-ai/app"
import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"

const SIDEBAR_MIN = 260
const SIDEBAR_MAX = 460
const SIDEBAR_DEFAULT = 326
const SIDEBAR_STORAGE_KEY = "sidebar-width"
const SHELL_LAYOUT_STORAGE_KEY = "layout-v3-initialized"

type SidebarView = "projects" | "plugins" | "automations"

const clampSidebar = (value: number) => Math.min(Math.max(Math.round(value), SIDEBAR_MIN), SIDEBAR_MAX)

function isPrimarySession(session: { parentID?: string; time?: { archived?: number } }) {
  return !session.parentID && !session.time?.archived
}

function relativeTime(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return "now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  return `${weeks}w`
}

export function DesktopFrame(props: ParentProps) {
  const platform = usePlatform()
  const [width, setWidth] = createSignal(SIDEBAR_DEFAULT)
  const [appReady, setAppReady] = createSignal(false)
  let host: HTMLElement | undefined
  let dragging = false
  let startX = 0
  let startWidth = SIDEBAR_DEFAULT

  const storage = platform.storage?.("desktop-shell.dat")

  const persist = () => {
    void storage?.setItem(SIDEBAR_STORAGE_KEY, String(width()))
  }

  const stopResize = () => {
    if (!dragging) return
    dragging = false
    document.documentElement.classList.remove("desktop-shell-resizing")
    persist()
  }

  const moveResize = (event: PointerEvent) => {
    if (!dragging) return
    setWidth(clampSidebar(startWidth + event.clientX - startX))
  }

  const startResize: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent> = (event) => {
    if (event.button !== 0) return
    dragging = true
    startX = event.clientX
    startWidth = width()
    document.documentElement.classList.add("desktop-shell-resizing")
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const resizeWithKeyboard: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setWidth((current) => clampSidebar(current + (event.key === "ArrowLeft" ? -12 : 12)))
    persist()
  }

  onMount(() => {
    document.documentElement.dataset.nikcliDesktop = "true"
    void Promise.resolve(storage?.getItem(SIDEBAR_STORAGE_KEY))
      .then((value) => {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) setWidth(clampSidebar(parsed))
      })
      .catch(() => undefined)

    window.addEventListener("pointermove", moveResize)
    window.addEventListener("pointerup", stopResize)

    // The shared app interface connects to the server and mounts its router
    // asynchronously; until it produces DOM the workspace is blank. Keep a
    // splash over the app host until the first real content node appears so
    // the center never flashes empty on load.
    const markReady = () => {
      if (!host) return false
      for (const child of host.children) {
        if (child.id === "desktop-tools-mount") continue
        if (child.classList.contains("desktop-app-splash")) continue
        setAppReady(true)
        return true
      }
      return false
    }
    if (!markReady()) {
      const observer = new MutationObserver(() => {
        if (markReady()) observer.disconnect()
      })
      if (host) observer.observe(host, { childList: true })
      onCleanup(() => observer.disconnect())
    }
  })

  onCleanup(() => {
    window.removeEventListener("pointermove", moveResize)
    window.removeEventListener("pointerup", stopResize)
    document.documentElement.classList.remove("desktop-shell-resizing")
    delete document.documentElement.dataset.nikcliDesktop
  })

  return (
    <div data-component="desktop-shell" style={{ "--desktop-sidebar-width": `${width()}px` }}>
      <aside id="desktop-sidebar-mount" aria-label="Projects and sessions" />
      <section class="desktop-app-host" ref={host}>
        <Show when={!appReady()}>
          <div class="desktop-app-splash" aria-hidden="true">
            <Splash class="desktop-app-splash__logo" />
          </div>
        </Show>
        {props.children}
        <div id="desktop-tools-mount" />
      </section>
      <div
        class="desktop-sidebar-resize"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={width()}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      />
    </div>
  )
}

function NavButton(props: {
  icon: Parameters<typeof Icon>[0]["name"]
  label: string
  active?: boolean
  badge?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class="desktop-nav-button"
      classList={{ "desktop-nav-button--active": props.active }}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="normal" />
      <span>{props.label}</span>
      <Show when={props.badge}>{(badge) => <span class="desktop-nav-button__badge">{badge()}</span>}</Show>
    </button>
  )
}

function ProjectGroup(props: {
  project: LocalProject
  activeDirectory: string | undefined
  activeSessionID: string | undefined
  now: number
  onOpenProject: (project: LocalProject) => void
  onOpenSession: (project: LocalProject, sessionID: string) => void
}) {
  const sync = useGlobalSync()
  const layout = useLayout()
  const [data] = sync.child(props.project.worktree, { bootstrap: false })
  const expanded = () => props.project.expanded !== false
  const slug = createMemo(() => base64Encode(props.project.worktree))
  const selected = createMemo(() => slug() === props.activeDirectory)
  const sessions = createMemo(() =>
    data.session
      .filter(isPrimarySession)
      .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 6),
  )

  const toggle = (event: Event) => {
    event.stopPropagation()
    if (expanded()) layout.projects.collapse(props.project.worktree)
    else layout.projects.expand(props.project.worktree)
  }

  return (
    <section class="desktop-project" classList={{ "desktop-project--active": selected() }}>
      <div class="desktop-project__header">
        <button type="button" class="desktop-project__select" onClick={() => props.onOpenProject(props.project)}>
          <span class="desktop-project__folder">
            <Icon name="folder" size="normal" />
          </span>
          <span class="desktop-project__name">{props.project.name || getFilename(props.project.worktree)}</span>
        </button>
        <button
          type="button"
          class="desktop-project__chevron"
          classList={{ "desktop-project__chevron--collapsed": !expanded() }}
          aria-label={expanded() ? "Collapse project" : "Expand project"}
          onClick={toggle}
        >
          <Icon name="chevron-down" size="small" />
        </button>
      </div>
      <Show when={expanded()}>
        <div class="desktop-project__sessions">
          <For each={sessions()}>
            {(session) => (
              <button
                type="button"
                class="desktop-session-row"
                classList={{ "desktop-session-row--active": selected() && session.id === props.activeSessionID }}
                onClick={() => props.onOpenSession(props.project, session.id)}
                title={session.title}
              >
                <span class="desktop-session-row__title">{session.title}</span>
                <span class="desktop-session-row__time">
                  {relativeTime(session.time.updated ?? session.time.created, props.now)}
                </span>
              </button>
            )}
          </For>
          <Show when={sessions().length === 0}>
            <button
              type="button"
              class="desktop-session-row desktop-session-row--empty"
              onClick={() => props.onOpenProject(props.project)}
            >
              Start a new session
            </button>
          </Show>
        </div>
      </Show>
    </section>
  )
}

function DesktopSidebar() {
  const command = useCommand()
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const params = useParams()
  const navigate = useNavigate()
  const [view, setView] = createSignal<SidebarView>("projects")
  const [now, setNow] = createSignal(Date.now())

  const projects = createMemo(() => layout.projects.list())
  const plugins = createMemo(() => sync.data.config.plugin ?? [])
  const automations = createMemo(() =>
    command.options
      .filter((option) => !option.id.startsWith("suggested.") && !option.disabled && !!option.onSelect)
      .slice(0, 30),
  )

  onMount(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    onCleanup(() => window.clearInterval(timer))
  })

  const openProject = (project: LocalProject) => {
    const slug = base64Encode(project.worktree)
    layout.projects.open(project.worktree)
    navigate(`/${slug}/session`)
  }

  const openSession = (project: LocalProject, sessionID: string) => {
    const slug = base64Encode(project.worktree)
    layout.projects.open(project.worktree)
    navigate(`/${slug}/session/${sessionID}`)
  }

  const newSession = () => {
    const current = projects().find((project) => base64Encode(project.worktree) === params.dir) ?? projects()[0]
    if (!current) {
      command.trigger("project.open")
      return
    }
    openProject(current)
  }

  const toggleView = (next: SidebarView) => setView((current) => (current === next ? "projects" : next))

  return (
    <div class="desktop-sidebar">
      <div class="desktop-sidebar__titlebar" data-tauri-drag-region>
        <div class="desktop-sidebar__history" aria-hidden="true">
          <Icon name="arrow-left" size="small" />
          <Icon name="arrow-right" size="small" />
        </div>
      </div>

      <div class="desktop-sidebar__primary">
        <NavButton icon="edit-small-2" label="New chat" onClick={newSession} />
        <NavButton icon="magnifying-glass" label="Search" onClick={command.show} />
        <NavButton
          icon="mcp"
          label="Plugins"
          active={view() === "plugins"}
          badge={plugins().length ? String(plugins().length) : undefined}
          onClick={() => toggleView("plugins")}
        />
        <NavButton
          icon="task"
          label="Automations"
          active={view() === "automations"}
          badge={automations().length ? String(automations().length) : undefined}
          onClick={() => toggleView("automations")}
        />
      </div>

      <div class="desktop-sidebar__content">
        <Show when={view() === "projects"}>
          <div class="desktop-sidebar__section-heading">
            <span>Projects</span>
            <button type="button" onClick={() => command.trigger("project.open")} aria-label="Open project">
              <Icon name="plus-small" size="small" />
            </button>
          </div>
          <div class="desktop-sidebar__scroll">
            <For each={projects()}>
              {(project) => (
                <ProjectGroup
                  project={project}
                  activeDirectory={params.dir}
                  activeSessionID={params.id}
                  now={now()}
                  onOpenProject={openProject}
                  onOpenSession={openSession}
                />
              )}
            </For>
            <Show when={projects().length === 0}>
              <button type="button" class="desktop-sidebar__empty" onClick={() => command.trigger("project.open")}>
                <Icon name="folder-add-left" size="normal" />
                <span>Open a project to get started</span>
              </button>
            </Show>
          </div>
        </Show>

        <Show when={view() === "plugins"}>
          <div class="desktop-sidebar__section-heading">
            <span>Configured plugins</span>
            <button type="button" onClick={() => setView("projects")} aria-label="Close plugins">
              <Icon name="close-small" size="small" />
            </button>
          </div>
          <div class="desktop-sidebar__scroll desktop-sidebar__list">
            <For each={plugins()}>
              {(plugin) => (
                <div class="desktop-sidebar__list-item">
                  <Icon name="mcp" size="small" />
                  <span>{String(plugin)}</span>
                </div>
              )}
            </For>
            <Show when={plugins().length === 0}>
              <div class="desktop-sidebar__notice">No plugins are configured in nikcli.json.</div>
            </Show>
          </div>
        </Show>

        <Show when={view() === "automations"}>
          <div class="desktop-sidebar__section-heading">
            <span>Available actions</span>
            <button type="button" onClick={() => setView("projects")} aria-label="Close automations">
              <Icon name="close-small" size="small" />
            </button>
          </div>
          <div class="desktop-sidebar__scroll desktop-sidebar__list">
            <For each={automations()}>
              {(item) => (
                <button type="button" class="desktop-sidebar__list-item" onClick={() => command.trigger(item.id)}>
                  <Icon name="task" size="small" />
                  <span>{item.title}</span>
                  <Show when={command.keybind(item.id)}>{(keybind) => <kbd>{keybind()}</kbd>}</Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <button type="button" class="desktop-sidebar__settings" onClick={() => command.trigger("settings.open")}>
        <Icon name="settings-gear" size="normal" />
        <span>Settings</span>
        <span class="desktop-sidebar__version">v{platform.version}</span>
      </button>
    </div>
  )
}

function ToolButton(props: {
  icon: Parameters<typeof Icon>[0]["name"]
  label: string
  keybind?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class="desktop-tool-button"
      classList={{ "desktop-tool-button--active": props.active }}
      disabled={props.disabled}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="normal" />
      <span>{props.label}</span>
      <Show when={props.keybind}>{(keybind) => <kbd>{keybind()}</kbd>}</Show>
    </button>
  )
}

function DesktopTools() {
  const command = useCommand()
  const layout = useLayout()
  const platform = usePlatform()
  const server = useServer()
  const params = useParams()
  const sessionKey = createMemo(() => `${params.dir ?? ""}${params.id ? `/${params.id}` : ""}`)
  const view = layout.view(sessionKey)
  const storage = platform.storage?.("desktop-shell.dat")
  const available = createMemo(() => !!params.dir)
  const terminalBottom = createMemo(() =>
    available() && view.terminal.opened() ? `${layout.terminal.height()}px` : "0px",
  )
  const sidePanelOpen = createMemo(() => available() && (view.reviewPanel.opened() || layout.fileTree.opened()))

  onMount(() => {
    void Promise.resolve(storage?.getItem(SHELL_LAYOUT_STORAGE_KEY))
      .then((initialized) => {
        if (initialized === "true") return
        layout.fileTree.close()
        view.reviewPanel.close()
        view.terminal.open()
        return Promise.resolve(storage?.setItem(SHELL_LAYOUT_STORAGE_KEY, "true"))
      })
      .catch(() => undefined)
  })

  const toggleReview = () => {
    const opening = !view.reviewPanel.opened()
    if (opening) layout.fileTree.close()
    view.reviewPanel.toggle()
  }

  const toggleFiles = () => {
    const opening = !layout.fileTree.opened()
    if (opening) view.reviewPanel.close()
    layout.fileTree.toggle()
  }

  return (
    <aside
      class="desktop-tools"
      classList={{ "desktop-tools--covered": sidePanelOpen() }}
      style={{ bottom: terminalBottom() }}
      aria-label="Workspace tools"
    >
      <div class="desktop-tools__actions">
        <ToolButton
          icon="checklist"
          label="Review"
          keybind={command.keybind("review.toggle")}
          active={available() && view.reviewPanel.opened()}
          disabled={!available()}
          onClick={toggleReview}
        />
        <ToolButton
          icon="console"
          label="Terminal"
          keybind={command.keybind("terminal.toggle")}
          active={available() && view.terminal.opened()}
          disabled={!available()}
          onClick={() => command.trigger("terminal.toggle")}
        />
        <ToolButton
          icon="window-cursor"
          label="Browser"
          disabled={!server.url}
          onClick={() => platform.openLink(server.url)}
        />
        <ToolButton
          icon="folder"
          label="Files"
          keybind={command.keybind("fileTree.toggle")}
          active={available() && layout.fileTree.opened()}
          disabled={!available()}
          onClick={toggleFiles}
        />
      </div>
    </aside>
  )
}

export function DesktopBridge() {
  const sidebarMount = () => document.getElementById("desktop-sidebar-mount")
  const toolsMount = () => document.getElementById("desktop-tools-mount")

  return (
    <>
      <Show when={sidebarMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <DesktopSidebar />
          </Portal>
        )}
      </Show>
      <Show when={toolsMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <DesktopTools />
          </Portal>
        )}
      </Show>
    </>
  )
}
