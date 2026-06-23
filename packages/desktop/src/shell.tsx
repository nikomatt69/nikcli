import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@nikcli-ai/util/encode"
import { getFilename } from "@nikcli-ai/util/path"
import { Icon } from "@nikcli-ai/ui/icon"
import { Splash } from "@nikcli-ai/ui/logo"
import { useCommand, useGlobalSDK, useGlobalSync, useLayout, usePlatform, type LocalProject } from "@nikcli-ai/app"
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
  type ParentProps,
} from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"

const SIDEBAR_MIN = 260
const SIDEBAR_MAX = 460
const SIDEBAR_DEFAULT = 326
const SIDEBAR_STORAGE_KEY = "sidebar-width"
const SHELL_LAYOUT_STORAGE_KEY = "layout-v4-initialized"

const REVIEW_MIN = 320
const REVIEW_MAX = 1200
const REVIEW_DEFAULT = 540
const REVIEW_STORAGE_KEY = "review-width"

// Mirror of Browser.MODELS / Browser.NATIVE_MODELS (packages/nikcli). Only the
// native models are billed by Browser Use with just a project key; the rest
// need a bring-your-own provider key on the BU project or their runs fail.
const BU_MODELS = [
  "bu-mini",
  "bu-max",
  "bu-ultra",
  "gemini-3-flash",
  "claude-sonnet-4.6",
  "claude-opus-4.6",
  "claude-opus-4.7",
  "gpt-5.4-mini",
] as const
const BU_NATIVE_MODELS = ["claude-sonnet-4.6", "claude-opus-4.6", "gpt-5.4-mini"] as const
const buRequiresOwnKey = (model: string) =>
  !!model && !BU_NATIVE_MODELS.includes(model as (typeof BU_NATIVE_MODELS)[number])

/** Map a nikcli model id to the closest Browser Use model, if any. */
function buFromModelID(modelID: string | undefined): string | undefined {
  if (!modelID) return undefined
  const id = modelID.toLowerCase()
  const exact = BU_MODELS.find((m) => m === id)
  if (exact) return exact
  if (id.includes("opus") && (id.includes("4.7") || id.includes("4-7"))) return "claude-opus-4.7"
  if (id.includes("opus") && (id.includes("4.6") || id.includes("4-6"))) return "claude-opus-4.6"
  if (id.includes("sonnet") && (id.includes("4.6") || id.includes("4-6"))) return "claude-sonnet-4.6"
  if (id.includes("gemini")) return "gemini-3-flash"
  if (id.includes("gpt-5")) return "gpt-5.4-mini"
  return undefined
}

/** What the active session provider/model resolves to for Browser Use. */
function buSessionLabel(configModel: string | undefined): string {
  const modelID = configModel?.includes("/") ? configModel.split("/").slice(1).join("/") : configModel
  const mapped = buFromModelID(modelID)
  if (mapped) return `${modelID} → ${mapped}`
  return modelID ? `${modelID} → claude-sonnet-4.6 fallback` : "claude-sonnet-4.6 (default)"
}

type SidebarView = "projects" | "plugins" | "automations"

const clampSidebar = (value: number) => Math.min(Math.max(Math.round(value), SIDEBAR_MIN), SIDEBAR_MAX)
const clampReview = (value: number, max = REVIEW_MAX) => Math.min(Math.max(Math.round(value), REVIEW_MIN), max)

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
  const [reviewWidth, setReviewWidth] = createSignal(REVIEW_DEFAULT)
  const [windowWidth, setWindowWidth] = createSignal(typeof window === "undefined" ? 1440 : window.innerWidth)
  const [appReady, setAppReady] = createSignal(false)
  let host: HTMLElement | undefined
  let dragging = false
  let startX = 0
  let startWidth = SIDEBAR_DEFAULT
  let draggingReview = false
  let startReviewX = 0
  let startReviewWidth = REVIEW_DEFAULT

  const storage = platform.storage?.("desktop-shell.dat")
  const reviewMax = createMemo(() =>
    Math.max(REVIEW_MIN, Math.min(REVIEW_MAX, Math.floor((windowWidth() - width()) * 0.45))),
  )
  const effectiveReviewWidth = createMemo(() => clampReview(reviewWidth(), reviewMax()))

  const syncWindowWidth = () => setWindowWidth(window.innerWidth)

  const persist = () => {
    void storage?.setItem(SIDEBAR_STORAGE_KEY, String(width()))
  }

  const persistReview = () => {
    void storage?.setItem(REVIEW_STORAGE_KEY, String(reviewWidth()))
  }

  const stopResize = () => {
    if (!dragging) return
    dragging = false
    document.documentElement.classList.remove("desktop-shell-resizing")
    persist()
  }

  const stopReviewResize = () => {
    if (!draggingReview) return
    draggingReview = false
    document.documentElement.classList.remove("desktop-shell-resizing")
    persistReview()
  }

  const moveResize = (event: PointerEvent) => {
    if (draggingReview) {
      setReviewWidth(clampReview(startReviewWidth - (event.clientX - startReviewX), reviewMax()))
      return
    }
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

  const startReviewResize: JSX.EventHandlerUnion<HTMLDivElement, PointerEvent> = (event) => {
    if (event.button !== 0) return
    draggingReview = true
    startReviewX = event.clientX
    startReviewWidth = effectiveReviewWidth()
    document.documentElement.classList.add("desktop-shell-resizing")
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const resizeWithKeyboard: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setWidth((current) => clampSidebar(current + (event.key === "ArrowLeft" ? -12 : 12)))
    persist()
  }

  const resizeReviewWithKeyboard: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setReviewWidth(clampReview(effectiveReviewWidth() + (event.key === "ArrowLeft" ? 16 : -16), reviewMax()))
    persistReview()
  }

  onMount(() => {
    document.documentElement.dataset.nikcliDesktop = "true"
    void Promise.resolve(storage?.getItem(SIDEBAR_STORAGE_KEY))
      .then((value) => {
        if (value == null) return
        const parsed = Number(value)
        if (Number.isFinite(parsed)) setWidth(clampSidebar(parsed))
      })
      .catch(() => undefined)

    void Promise.resolve(storage?.getItem(REVIEW_STORAGE_KEY))
      .then((value) => {
        if (value == null) return
        const parsed = Number(value)
        if (Number.isFinite(parsed)) setReviewWidth(clampReview(parsed))
      })
      .catch(() => undefined)

    window.addEventListener("resize", syncWindowWidth)
    window.addEventListener("pointermove", moveResize)
    window.addEventListener("pointerup", stopResize)
    window.addEventListener("pointerup", stopReviewResize)

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
    window.removeEventListener("resize", syncWindowWidth)
    window.removeEventListener("pointermove", moveResize)
    window.removeEventListener("pointerup", stopResize)
    window.removeEventListener("pointerup", stopReviewResize)
    document.documentElement.classList.remove("desktop-shell-resizing")
    delete document.documentElement.dataset.nikcliDesktop
  })

  return (
    <div
      data-component="desktop-shell"
      style={{
        "--desktop-sidebar-width": `${width()}px`,
        "--desktop-review-width": `${effectiveReviewWidth()}px`,
      }}
    >
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
      <div
        class="desktop-review-resize"
        role="separator"
        aria-label="Resize review panel"
        aria-orientation="vertical"
        aria-valuemin={REVIEW_MIN}
        aria-valuemax={reviewMax()}
        aria-valuenow={effectiveReviewWidth()}
        tabIndex={0}
        onPointerDown={startReviewResize}
        onKeyDown={resizeReviewWithKeyboard}
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
                classList={{
                  "desktop-session-row--active": selected() && session.id === props.activeSessionID,
                }}
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

type AutomationPart = {
  id: string
  tool: "browser" | "computer"
  state: {
    status: "pending" | "running" | "completed" | "error"
    input: Record<string, unknown>
    title?: string
    output?: string
    error?: string
    metadata?: Record<string, unknown>
    attachments?: Array<{
      mime: string
      url?: string
      source?: { type: "file"; path: string }
    }>
  }
}

type AutomationSurface = "browser" | "computer"

function automationMetadata(part: AutomationPart | undefined) {
  if (!part) return {}
  return part.state.metadata ?? {}
}

function automationScreenshot(part: AutomationPart | undefined) {
  if (!part || part.state.status !== "completed") return
  return part.state.attachments?.find((attachment) => attachment.mime.startsWith("image/"))?.url
}

function AutomationPanel(props: { surface: AutomationSurface; part?: AutomationPart }) {
  const globalSDK = useGlobalSDK()
  const sync = useGlobalSync()
  const [setup, setSetup] = createStore({ open: false, saving: false, saved: false, error: "" })
  const browserModel = createMemo(() => sync.data.config.browser?.model || "")
  const sessionLabel = createMemo(() => buSessionLabel(sync.data.config.model))
  const effectiveModelLabel = createMemo(() =>
    browserModel() ? `${browserModel()} (browser config)` : sessionLabel(),
  )

  // Empty value clears the override so the browser tool follows the session model.
  const saveBrowserModel = async (model: string) => {
    try {
      await globalSDK.client.config.update({ config: { browser: { model } } as any })
    } catch (error) {
      setSetup("error", error instanceof Error ? error.message : String(error))
    }
  }
  const metadata = createMemo(() => automationMetadata(props.part))
  const screenshot = createMemo(() => automationScreenshot(props.part))
  const liveUrl = createMemo(() => {
    const value = metadata().liveUrl
    return typeof value === "string" ? value : undefined
  })
  const summary = createMemo(() => {
    const value = metadata().summary
    if (typeof value === "string" && value.trim()) return value
    const task = props.part?.state.input.task
    if (typeof task === "string" && task.trim()) return task
    return undefined
  })
  const output = createMemo(() => {
    if (props.part?.state.status === "error") return props.part.state.error
    if (props.part?.state.status !== "completed") return undefined
    return props.part.state.output?.trim()
  })
  const configured = createMemo(() => {
    const value = metadata().configured
    return typeof value === "boolean" ? value || setup.saved : undefined
  })

  const saveBrowserUseKey: JSX.EventHandlerUnion<HTMLFormElement, SubmitEvent> = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const key = String(data.get("apiKey") ?? "").trim()
    if (!/^bu_[A-Za-z0-9_-]+$/.test(key)) {
      setSetup("error", "Enter a valid Browser Use key starting with bu_.")
      return
    }
    setSetup({ saving: true, error: "" })
    try {
      await globalSDK.client.auth.set({ providerID: "browser-use", auth: { type: "api", key } })
      form.reset()
      setSetup({ saving: false, saved: true, open: false, error: "" })
    } catch (error) {
      setSetup({ saving: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <section class="desktop-automation" data-surface={props.surface}>
      <div class="desktop-automation__status">
        <span class="desktop-automation__status-icon">
          <Icon name={props.surface === "browser" ? "window-cursor" : "console"} size="normal" />
        </span>
        <div>
          <strong>{props.surface === "browser" ? "Browser Use" : "Computer Use"}</strong>
          <span>{summary() ?? (props.surface === "browser" ? "Cloud browser workbench" : "Background desktop (sandbox)")}</span>
        </div>
        <span class="desktop-automation__badge" data-status={props.part?.state.status ?? "idle"}>
          {props.part?.state.status ?? "idle"}
        </span>
      </div>

      <Show when={props.surface === "browser" && configured() === false}>
        <div class="desktop-automation__empty">
          <Icon name="window-cursor" size="large" />
          <strong>Browser Use needs an API key</strong>
          <span>Add a Browser Use project key to nikcli, then start a browser task.</span>
          <button type="button" onClick={() => setSetup("open", true)}>Configure Browser Use</button>
        </div>
      </Show>

      <Show when={(props.surface === "computer" || configured() !== false) && liveUrl()}>
        {(url) => (
          <iframe
            class="desktop-automation__live"
            src={url()}
            title={props.surface === "browser" ? "Browser Use live preview" : "Computer Use live preview"}
            allow="clipboard-read; clipboard-write"
          />
        )}
      </Show>

      <Show when={!liveUrl() && screenshot()}>
        {(url) => <img class="desktop-automation__image" src={url()} alt={`${props.surface} screenshot`} />}
      </Show>

      <Show when={!props.part && (props.surface === "computer" || configured() !== false)}>
        <div class="desktop-automation__empty">
          <Icon name={props.surface === "browser" ? "window-cursor" : "console"} size="large" />
          <strong>{props.surface === "browser" ? "No browser session yet" : "No computer activity yet"}</strong>
          <span>
            {props.surface === "browser"
              ? "Ask Nikcli to use the browser. The live session will appear here."
              : "Ask Nikcli to control a computer. It runs on a background desktop — the live preview will appear here."}
          </span>
          <Show when={props.surface === "browser"}>
            <button type="button" onClick={() => setSetup("open", true)}>Configure Browser Use</button>
          </Show>
        </div>
      </Show>

      <Show when={props.surface === "browser" && setup.open}>
        <form class="desktop-automation__setup" onSubmit={saveBrowserUseKey}>
          <div>
            <strong>Browser Use API key</strong>
            <span>Stored in nikcli's existing local auth vault.</span>
          </div>
          <input
            name="apiKey"
            type="password"
            placeholder="bu_..."
            autocomplete="off"
            spellcheck={false}
            disabled={setup.saving}
            autofocus
          />
          <div class="desktop-automation__setup-field">
            <strong>Model</strong>
            <span>Effective: {effectiveModelLabel()}</span>
            <select
              value={browserModel()}
              disabled={setup.saving}
              onChange={(event) => void saveBrowserModel(event.currentTarget.value)}
            >
              <option value="">Use session model ({sessionLabel()})</option>
              <optgroup label="Native models (no setup)">
                <For each={BU_MODELS.filter((m) => !buRequiresOwnKey(m))}>
                  {(model) => <option value={model}>{model}</option>}
                </For>
              </optgroup>
              <optgroup label="Bring-your-own-key models">
                <For each={BU_MODELS.filter((m) => buRequiresOwnKey(m))}>
                  {(model) => <option value={model}>{model} ⚠ BYO key</option>}
                </For>
              </optgroup>
            </select>
            <Show when={buRequiresOwnKey(browserModel())}>
              <span class="desktop-automation__setup-warning">
                ⚠ This model needs a provider key on your Browser Use project (cloud.browser-use.com),
                or runs will fail. Pick a native model to avoid setup.
              </span>
            </Show>
          </div>
          <Show when={setup.error}><span class="desktop-automation__setup-error">{setup.error}</span></Show>
          <div class="desktop-automation__setup-actions">
            <button type="button" disabled={setup.saving} onClick={() => setSetup("open", false)}>Cancel</button>
            <button type="submit" disabled={setup.saving}>{setup.saving ? "Saving…" : "Save key"}</button>
          </div>
        </form>
      </Show>

      <Show when={props.part && !liveUrl() && !screenshot()}>
        <div class="desktop-automation__activity">
          <span class="desktop-automation__pulse" />
          <span>{summary() ?? props.part?.state.title ?? `Running ${props.surface} action`}</span>
        </div>
      </Show>

      <Show when={output()}>
        {(value) => <pre class="desktop-automation__output">{value().slice(0, 6000)}</pre>}
      </Show>
    </section>
  )
}

function DesktopTools() {
  const command = useCommand()
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const params = useParams()
  const sessionKey = createMemo(() => `${params.dir ?? ""}${params.id ? `/${params.id}` : ""}`)
  const view = layout.view(sessionKey)
  const storage = platform.storage?.("desktop-shell.dat")
  const [workbench, setWorkbench] = createStore<{
    active: AutomationSurface
    menu: boolean
  }>({ active: "browser", menu: false })
  const available = createMemo(() => !!params.dir)
  const terminalBottom = createMemo(() =>
    available() && view.terminal.opened() ? `${layout.terminal.height()}px` : "0px",
  )
  const sidePanelOpen = createMemo(() => available() && (view.reviewPanel.opened() || layout.fileTree.opened()))
  const fileTreeOpen = createMemo(() => available() && layout.fileTree.opened())
  const reviewOnlyOpen = createMemo(() => available() && view.reviewPanel.opened() && !fileTreeOpen())
  const activeProject = createMemo(() =>
    layout.projects.list().find((project) => base64Encode(project.worktree) === params.dir),
  )
  const activeData = createMemo(() => {
    const project = activeProject()
    if (!project) return
    return sync.child(project.worktree, { bootstrap: false })[0]
  })
  const automationParts = createMemo(() => {
    const data = activeData()
    const sessionID = params.id
    if (!data || !sessionID) return [] as AutomationPart[]
    return (data.message[sessionID] ?? []).flatMap((message) =>
      (data.part[message.id] ?? [])
        .filter((part) => part.type === "tool" && (part.tool === "browser" || part.tool === "computer"))
        .map((part) => part as unknown as AutomationPart),
    )
  })
  const latestPart = createMemo(() => {
    const parts = automationParts()
    return [...parts].reverse().find((part) => part.tool === workbench.active)
  })
  const latestAutomation = createMemo(() => automationParts().at(-1))
  let previousPanels = { review: false, files: false }
  let menuHost: HTMLDivElement | undefined

  createEffect(() => {
    const next = {
      review: available() && view.reviewPanel.opened(),
      files: fileTreeOpen(),
    }

    if (next.review && next.files) {
      if (!previousPanels.review && previousPanels.files) layout.fileTree.close()
      else if (previousPanels.review && !previousPanels.files) view.reviewPanel.close()
      else layout.fileTree.close()
    }

    previousPanels = next
  })

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

    const closeMenu = (event: PointerEvent) => {
      if (!workbench.menu || menuHost?.contains(event.target as Node)) return
      setWorkbench("menu", false)
    }
    const closeMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkbench("menu", false)
    }
    document.addEventListener("pointerdown", closeMenu)
    document.addEventListener("keydown", closeMenuWithKeyboard)
    onCleanup(() => {
      document.removeEventListener("pointerdown", closeMenu)
      document.removeEventListener("keydown", closeMenuWithKeyboard)
    })
  })

  createEffect(() => {
    const latest = latestAutomation()
    if (!latest) return
    setWorkbench("active", latest.tool)
    view.reviewPanel.close()
    layout.fileTree.close()
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

  const showAutomation = (surface: AutomationSurface) => {
    view.reviewPanel.close()
    layout.fileTree.close()
    setWorkbench({ active: surface, menu: false })
  }

  return (
    <aside
      class="desktop-tools"
      classList={{
        "desktop-tools--covered": sidePanelOpen(),
        "desktop-tools--review": reviewOnlyOpen(),
        "desktop-tools--files": fileTreeOpen(),
      }}
      style={{ bottom: terminalBottom() }}
      aria-label="Workspace tools"
    >
      <div class="desktop-workbench__bar">
        <button type="button" class="desktop-workbench__tab" aria-current="page">
          <Icon name={workbench.active === "browser" ? "window-cursor" : "console"} size="small" />
          <span>{workbench.active === "browser" ? "Browser" : "Computer"}</span>
          <Show when={latestPart()?.state.status === "running"}>
            <span class="desktop-workbench__running" />
          </Show>
        </button>
        <div class="desktop-workbench__menu-host" ref={menuHost}>
          <button
            type="button"
            class="desktop-workbench__add"
            aria-label="Open workspace tool"
            aria-expanded={workbench.menu}
            onClick={() => setWorkbench("menu", (value) => !value)}
          >
            <Icon name="plus-small" size="small" />
          </button>
          <Show when={workbench.menu}>
            <div class="desktop-workbench__menu" role="menu">
              <ToolButton
                icon="checklist"
                label="Review"
                keybind={command.keybind("review.toggle")}
                active={available() && view.reviewPanel.opened()}
                disabled={!available()}
                onClick={() => {
                  setWorkbench("menu", false)
                  toggleReview()
                }}
              />
              <ToolButton
                icon="console"
                label="Terminal"
                keybind={command.keybind("terminal.toggle")}
                active={available() && view.terminal.opened()}
                disabled={!available()}
                onClick={() => {
                  setWorkbench("menu", false)
                  command.trigger("terminal.toggle")
                }}
              />
              <ToolButton
                icon="window-cursor"
                label="Browser"
                active={workbench.active === "browser" && !sidePanelOpen()}
                onClick={() => showAutomation("browser")}
              />
              <ToolButton
                icon="console"
                label="Computer"
                active={workbench.active === "computer" && !sidePanelOpen()}
                onClick={() => showAutomation("computer")}
              />
              <ToolButton
                icon="folder"
                label="Files"
                keybind={command.keybind("fileTree.toggle")}
                active={available() && layout.fileTree.opened()}
                disabled={!available()}
                onClick={() => {
                  setWorkbench("menu", false)
                  toggleFiles()
                }}
              />
            </div>
          </Show>
        </div>
      </div>
      <AutomationPanel surface={workbench.active} part={latestPart()} />
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
