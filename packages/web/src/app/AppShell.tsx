import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type {
  FileDiff,
  MobileAuthTokenPublic,
  MobileBootstrap,
  MobileCommand,
  MobileExecutionTarget,
  MobileGithubBranch,
  MobileGithubDeviceAuthStart,
  MobileProject,
  MobileSessionDetail,
  MobileSessionSummary,
} from "@nikcli-ai/sdk/v2/client"
import {
  clearServerConfig,
  formatRelativeTime,
  getErrorMessage,
  loadServerConfig,
  normalizeServerUrl,
  parsePairingLink,
  saveServerConfig,
  sessionLocation,
  type AppServerConfig,
  type ProviderCatalog,
  WebNikcliClient,
} from "@/app/api"
import {
  messagePlainText,
  parseSlashCommand,
  patchPart,
  reasoningText,
  reduceSessionDetail,
  sessionErrorMessage,
  toolParts,
  upsertPart,
  type MessageWithParts,
} from "@/app/session-state"

type GithubRepo = Awaited<ReturnType<WebNikcliClient["listGithubRepos"]>>[number]

type AppRoute =
  | { screen: "root" }
  | { screen: "connect" }
  | { screen: "sessions" }
  | { screen: "session"; sessionId: string }
  | { screen: "repos" }
  | { screen: "settings" }

type AppContextValue = {
  configReady: boolean
  config: AppServerConfig | null
  client: WebNikcliClient | null
  bootstrap: MobileBootstrap | null
  bootstrapLoading: boolean
  bootstrapError: string | null
  save(next: AppServerConfig): void
  clear(): void
  refreshBootstrap(): Promise<MobileBootstrap | null>
}

const AppContext = createContext<AppContextValue | null>(null)

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncateMiddle(value: string, max = 64) {
  if (value.length <= max) return value
  const slice = Math.max(12, Math.floor((max - 3) / 2))
  return `${value.slice(0, slice)}...${value.slice(-slice)}`
}

function currentProjectLabel(project?: { name?: string; worktree?: string }) {
  if (!project) return "No active workspace"
  if (project.name) return project.name
  if (!project.worktree) return "No active workspace"
  return project.worktree.split("/").filter(Boolean).pop() || project.worktree
}

function safeDecodeSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function safeOwner(fullName?: string | null) {
  if (!fullName) return null
  const owner = fullName.split("/")[0]?.trim()
  return owner || null
}

function providerFallback(catalog: ProviderCatalog | null, preferred?: string) {
  if (!catalog?.all.length) return preferred
  if (preferred && catalog.all.some((provider) => provider.id === preferred)) return preferred
  return catalog.all[0]?.id
}

function modelFallback(catalog: ProviderCatalog | null, providerID?: string, preferred?: string) {
  if (!catalog || !providerID) return preferred
  const provider = catalog.all.find((item) => item.id === providerID)
  if (!provider) return preferred
  if (preferred && provider.models[preferred]) return preferred
  const defaultModel = catalog.default[providerID]
  if (defaultModel && provider.models[defaultModel]) return defaultModel
  return Object.keys(provider.models)[0]
}

function parseAppRoute(pathname: string): AppRoute {
  const normalized = pathname.replace(/\/$/, "") || "/app"
  if (normalized === "/app") return { screen: "root" }
  if (normalized === "/app/connect") return { screen: "connect" }
  if (normalized === "/app/sessions") return { screen: "sessions" }
  if (normalized === "/app/repos") return { screen: "repos" }
  if (normalized === "/app/settings") return { screen: "settings" }

  const sessionMatch = normalized.match(/^\/app\/sessions\/([^/]+)$/)
  if (sessionMatch) {
    return {
      screen: "session",
      sessionId: safeDecodeSegment(sessionMatch[1]),
    }
  }

  return { screen: "root" }
}

function useAppRouter(initialPath: string) {
  const [path, setPath] = useState(initialPath)

  useEffect(() => {
    if (typeof window === "undefined") return
    const sync = () => setPath(window.location.pathname)
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  const navigate = useCallback((next: string, options?: { replace?: boolean }) => {
    if (typeof window === "undefined") return
    const url = next.startsWith("/app") ? next : `/app${next.startsWith("/") ? next : `/${next}`}`
    if (options?.replace) window.history.replaceState({}, "", url)
    else window.history.pushState({}, "", url)
    setPath(url)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  return {
    path,
    route: parseAppRoute(path),
    navigate,
  }
}

function useThemeMode() {
  const [theme, setTheme] = useState<"light" | "dark">("light")

  useEffect(() => {
    if (typeof window === "undefined") return
    const root = document.documentElement
    const media = window.matchMedia("(prefers-color-scheme: dark)")

    const syncTheme = () => {
      const current = root.getAttribute("data-theme")
      if (current === "dark" || current === "light") {
        setTheme(current)
        return
      }

      const stored = window.localStorage.getItem("theme")
      if (stored === "dark" || stored === "light") {
        root.setAttribute("data-theme", stored)
        setTheme(stored)
        return
      }

      const next = media.matches ? "dark" : "light"
      root.setAttribute("data-theme", next)
      setTheme(next)
    }

    syncTheme()

    const observer = new MutationObserver(syncTheme)
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] })

    window.addEventListener("storage", syncTheme)
    media.addEventListener?.("change", syncTheme)

    return () => {
      observer.disconnect()
      window.removeEventListener("storage", syncTheme)
      media.removeEventListener?.("change", syncTheme)
    }
  }, [])

  const applyTheme = useCallback((next: "light" | "dark") => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("theme", next)
    document.documentElement.setAttribute("data-theme", next)
    setTheme(next)
  }, [])

  return {
    theme,
    toggleTheme() {
      applyTheme(theme === "dark" ? "light" : "dark")
    },
  }
}

function AppProvider(props: { children: ReactNode }) {
  const [configReady, setConfigReady] = useState(false)
  const [config, setConfig] = useState<AppServerConfig | null>(null)
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null)
  const [bootstrapLoading, setBootstrapLoading] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  useEffect(() => {
    setConfig(loadServerConfig())
    setConfigReady(true)
  }, [])

  const client = useMemo(() => (config ? new WebNikcliClient(config) : null), [config])

  const refreshBootstrap = useCallback(async () => {
    if (!client) {
      setBootstrap(null)
      setBootstrapError(null)
      setBootstrapLoading(false)
      return null
    }

    try {
      setBootstrapLoading(true)
      const next = await client.bootstrap()
      setBootstrap(next)
      setBootstrapError(null)
      return next
    } catch (error) {
      const message = getErrorMessage(error)
      setBootstrap(null)
      setBootstrapError(message)
      return null
    } finally {
      setBootstrapLoading(false)
    }
  }, [client])

  useEffect(() => {
    if (!client) {
      setBootstrap(null)
      setBootstrapLoading(false)
      setBootstrapError(null)
      return
    }
    void refreshBootstrap()
  }, [client, refreshBootstrap])

  const value = useMemo<AppContextValue>(
    () => ({
      configReady,
      config,
      client,
      bootstrap,
      bootstrapLoading,
      bootstrapError,
      save(next) {
        saveServerConfig(next)
        setConfig(next)
      },
      clear() {
        clearServerConfig()
        setConfig(null)
        setBootstrap(null)
        setBootstrapError(null)
      },
      refreshBootstrap,
    }),
    [bootstrap, bootstrapError, bootstrapLoading, client, config, configReady, refreshBootstrap],
  )

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
}

function useAppContext() {
  const value = useContext(AppContext)
  if (!value) throw new Error("App context is unavailable")
  return value
}

function Spinner(props: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-3 text-sm text-terminal-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
      {props.label ? <span>{props.label}</span> : null}
    </div>
  )
}

function Banner(props: { tone?: "error" | "good" | "warn"; children: ReactNode }) {
  const tone = props.tone ?? "error"
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm shadow-soft",
        tone === "error" && "border-terminal-error/30 bg-terminal-error/10 text-terminal-text",
        tone === "good" && "border-terminal-accent/30 bg-terminal-accent/10 text-terminal-text",
        tone === "warn" && "border-terminal-warning/30 bg-terminal-warning/10 text-terminal-text",
      )}
    >
      {props.children}
    </div>
  )
}

function Chip(props: {
  label: string
  tone?: "neutral" | "accent" | "good" | "warn"
  caps?: boolean
  mono?: boolean
  className?: string
}) {
  const tone = props.tone ?? "neutral"
  const caps = props.caps ?? false
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium leading-none",
        caps ? "text-[11px] font-semibold uppercase tracking-[0.14em]" : "normal-case tracking-normal",
        props.mono && "font-mono text-[11px]",
        tone === "neutral" && "border-terminal-border/80 bg-terminal-panel/80 text-terminal-text",
        tone === "accent" && "border-terminal-accent/20 bg-terminal-accent/10 text-terminal-accent",
        tone === "good" && "border-terminal-success/20 bg-terminal-success/10 text-terminal-success",
        tone === "warn" && "border-terminal-warning/20 bg-terminal-warning/10 text-terminal-warning",
        props.className,
      )}
    >
      {tone !== "neutral" ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {props.label}
    </span>
  )
}

function StatusPill(props: { status?: MobileSessionSummary["status"] | MobileSessionDetail["status"] }) {
  const status = props.status?.type ?? "idle"
  const tone = status === "busy" ? "accent" : status === "retry" ? "warn" : "good"
  return <Chip label={status} tone={tone} caps />
}

function PathBadge(props: { path: string }) {
  return (
    <div
      title={props.path}
      className="min-w-0 w-full rounded-2xl border border-terminal-border/80 bg-terminal-panel px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
    >
      <code className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-terminal-text">
        {truncateMiddle(props.path, 72)}
      </code>
    </div>
  )
}

function Button(props: {
  children: ReactNode
  onClick?: () => void
  type?: "button" | "submit"
  variant?: "primary" | "secondary" | "ghost" | "danger"
  busy?: boolean
  disabled?: boolean
  className?: string
}) {
  const variant = props.variant ?? "primary"
  const disabled = props.disabled || props.busy
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition duration-150",
        variant === "primary" &&
          "border-terminal-accent/20 bg-terminal-accent text-terminal-bg shadow-glow hover:bg-terminal-accent/90 disabled:bg-terminal-accent/40",
        variant === "secondary" &&
          "border-terminal-border bg-terminal-panel text-terminal-text hover:bg-surface-hover disabled:opacity-50",
        variant === "ghost" &&
          "border-transparent bg-transparent text-terminal-muted hover:border-terminal-border hover:text-terminal-text",
        variant === "danger" &&
          "border-terminal-error/20 bg-terminal-error/10 text-terminal-error hover:bg-terminal-error/15 disabled:opacity-50",
        disabled && "cursor-not-allowed opacity-60",
        props.className,
      )}
    >
      {props.busy ? <Spinner label="Working" /> : props.children}
    </button>
  )
}

function Field(props: {
  label: string
  value: string
  onChange(value: string): void
  placeholder?: string
  type?: string
  help?: string
  autoComplete?: string
  spellCheck?: boolean
  action?: ReactNode
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">{props.label}</span>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <input
          type={props.type ?? "text"}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete}
          spellCheck={props.spellCheck}
          className="min-w-0 w-full rounded-2xl border border-terminal-border bg-terminal-panel px-4 py-3 text-sm text-terminal-text placeholder:text-terminal-muted/70"
        />
        {props.action ? (
          <div className="w-full shrink-0 sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">{props.action}</div>
        ) : null}
      </div>
      {props.help ? <span className="block text-xs text-terminal-muted">{props.help}</span> : null}
    </label>
  )
}

function TextAreaField(props: {
  label: string
  value: string
  onChange(value: string): void
  placeholder?: string
  rows?: number
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">{props.label}</span>
      <textarea
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 4}
        className="w-full rounded-2xl border border-terminal-border bg-terminal-panel px-4 py-3 text-sm text-terminal-text placeholder:text-terminal-muted/70"
      />
    </label>
  )
}

function SelectField(props: {
  label: string
  value: string
  onChange(value: string): void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
        className="w-full rounded-2xl border border-terminal-border bg-terminal-panel px-4 py-3 text-sm text-terminal-text disabled:opacity-50"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Surface(props: {
  eyebrow?: string
  title?: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[24px] border border-terminal-border bg-terminal-panel/95 px-4 py-4 shadow-strong sm:rounded-[28px] sm:px-5 sm:py-5",
        props.className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-6 top-px h-px bg-white/60 dark:bg-white/10" />
      <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-terminal-accent/10 blur-2xl" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-terminal-bg/30 to-transparent" />
      {(props.eyebrow || props.title || props.description || props.actions) && (
        <div className="relative flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            {props.eyebrow ? (
              <div className="text-eyebrow uppercase text-terminal-accent/90">{props.eyebrow}</div>
            ) : null}
            {props.title ? <h2 className="text-panel-title text-terminal-text">{props.title}</h2> : null}
            {props.description ? (
              <p className="max-w-3xl text-body-sm text-terminal-muted">{props.description}</p>
            ) : null}
          </div>
          {props.actions ? <div className="relative shrink-0">{props.actions}</div> : null}
        </div>
      )}
      {props.children ? (
        <div className={cn(props.title || props.description || props.eyebrow ? "relative mt-4" : "relative")}>
          {props.children}
        </div>
      ) : null}
    </section>
  )
}

function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-dashed border-terminal-border bg-terminal-panel/60 px-4 py-6 text-center shadow-soft sm:rounded-[28px] sm:px-6 sm:py-8">
      <h3 className="text-lg font-semibold text-terminal-text">{props.title}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-terminal-muted">{props.description}</p>
      {props.action ? <div className="mt-5 flex justify-center">{props.action}</div> : null}
    </div>
  )
}

function Modal(props: { open: boolean; title: string; children: ReactNode; onClose(): void }) {
  if (!props.open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-4 sm:py-8">
      <div className="max-h-[calc(100vh-0.75rem)] w-full max-w-2xl overflow-y-auto no-scrollbar rounded-[28px] border border-terminal-border bg-terminal-panel p-4 shadow-strong sm:max-h-[calc(100vh-2rem)] sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-xl font-semibold text-terminal-text">{props.title}</h3>
          <Button variant="ghost" onClick={props.onClose}>
            Close
          </Button>
        </div>
        {props.children}
      </div>
    </div>
  )
}

function AppNavButton(props: { label: string; active?: boolean; onClick(): void; hint?: string }) {
  return (
    <button
      onClick={props.onClick}
      className={cn(
        "flex w-full min-w-0 flex-col items-start gap-1 rounded-2xl border px-4 py-3 text-left transition sm:flex-row sm:items-center sm:justify-between",
        props.active
          ? "border-terminal-accent/20 bg-terminal-accent/10 text-terminal-text shadow-soft"
          : "border-terminal-border bg-terminal-panel/70 text-terminal-muted hover:bg-surface-hover hover:text-terminal-text",
      )}
    >
      <span className="font-semibold">{props.label}</span>
      {props.hint ? <span className="text-[11px] uppercase tracking-[0.16em]">{props.hint}</span> : null}
    </button>
  )
}

function ConnectScreen(props: { navigate(path: string, options?: { replace?: boolean }): void }) {
  const { config, save, bootstrap } = useAppContext()
  const [endpoint, setEndpoint] = useState(config?.url ?? "")
  const [token, setToken] = useState(config?.token ?? "")
  const [directory, setDirectory] = useState(config?.directory ?? "")
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setEndpoint(config?.url ?? "")
    setToken(config?.token ?? "")
    setDirectory(config?.directory ?? "")
  }, [config])

  const pairingPreview = useMemo(() => parsePairingLink(endpoint), [endpoint])

  const handleConnect = useCallback(async () => {
    const raw = endpoint.trim()
    if (!raw) {
      setMessage("Server URL or pairing link is required")
      return
    }

    const parsedPairing = parsePairingLink(raw)
    const next: AppServerConfig = {
      url: normalizeServerUrl(parsedPairing?.url ?? raw),
      token: (token.trim() || parsedPairing?.token || undefined) ?? undefined,
      directory: (directory.trim() || parsedPairing?.directory || undefined) ?? undefined,
      modelProviderID: config?.modelProviderID,
      modelID: config?.modelID,
      executionTarget: config?.executionTarget ?? "local",
    }

    try {
      setBusy(true)
      setMessage(null)
      const client = new WebNikcliClient(next)
      await client.bootstrap()
      save(next)
      props.navigate("/app/sessions")
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [config?.executionTarget, config?.modelID, config?.modelProviderID, directory, endpoint, props, save, token])

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Web control plane"
        title="Direct web access for your Railway-hosted Nikcli server."
        description="Use the exact same headless mobile routes, the same Bearer token pairing flow, and the same workspace selection model, but from a browser-first interface inside the existing site."
      >
        <div className="flex flex-wrap gap-2">
          <Chip label="Mobile route parity" tone="accent" />
          <Chip label="Bearer pairing" tone="good" />
          <Chip label="Realtime sessions" tone="accent" />
          <Chip label="Repo launch + PR publish" tone="neutral" />
        </div>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <Surface
          eyebrow="Secure pairing"
          title="Connect this browser"
          description="Paste the public Railway URL, or paste the `nikcli://connect?...` pairing link generated by the mobile pair command. The browser validates bootstrap before saving anything locally."
        >
          <div className="space-y-4">
            <Field
              label="Pairing link or server URL"
              value={endpoint}
              onChange={setEndpoint}
              placeholder="https://nikcli-mobile-production.up.railway.app"
              help="Supports both direct HTTPS endpoints and the `nikcli://connect` link format."
            />
            <Field
              label="Bearer token"
              value={token}
              onChange={setToken}
              type={showToken ? "text" : "password"}
              placeholder="nkm_..."
              autoComplete="off"
              spellCheck={false}
              action={
                <Button variant="secondary" onClick={() => setShowToken((current) => !current)}>
                  {showToken ? "Hide" : "Show"}
                </Button>
              }
              help="If you pasted a pairing link, the token is already embedded there."
            />
            <Field
              label="Default server directory"
              value={directory}
              onChange={setDirectory}
              placeholder="Optional repo or worktree path on the server"
            />
            <div className="flex flex-wrap gap-3">
              <Button busy={busy} onClick={() => void handleConnect()}>
                Validate and continue
              </Button>
              {bootstrap ? (
                <Button variant="secondary" onClick={() => props.navigate("/app/sessions")}>
                  Open sessions
                </Button>
              ) : null}
            </div>
            {pairingPreview ? (
              <Banner tone="good">
                Pairing link detected for `{pairingPreview.url}`
                {pairingPreview.directory ? ` in ${pairingPreview.directory}` : ""}.
              </Banner>
            ) : null}
            {message ? <Banner>{message}</Banner> : null}
          </div>
        </Surface>

        <div className="space-y-6">
          <Surface
            eyebrow="Hosted setup"
            title="Use the same pairing flow as mobile"
            description="Nothing changes on the server: you keep `nikcli mobile serve` or the same Railway deployment, and the web UI consumes the same headless `/mobile/*` API surface."
          >
            <div className="space-y-4 rounded-[24px] border border-terminal-border bg-terminal-code px-4 py-4 font-mono text-xs leading-6 text-terminal-text">
              <div>nikcli mobile serve --hostname 0.0.0.0 --port $PORT --public-url https://your-railway-url</div>
              <div>nikcli mobile pair --public-url https://your-railway-url --name web --expiry-days 90</div>
            </div>
          </Surface>

          <Surface
            eyebrow="Connection state"
            title={bootstrap ? "Host validated" : "Waiting for validation"}
            description={
              bootstrap
                ? `Connected to ${currentProjectLabel(bootstrap.currentProject)} on Nikcli ${bootstrap.version}.`
                : "Once the bootstrap check succeeds, sessions, repos, settings, and publish flows become available."
            }
          >
            <div className="flex flex-wrap gap-2">
              <Chip label={bootstrap ? "Online" : "Offline"} tone={bootstrap ? "good" : "warn"} />
              {bootstrap?.github?.connected ? (
                <Chip label={`@${bootstrap.github.user?.login ?? "github"}`} tone="accent" />
              ) : null}
              {bootstrap?.execution.container.available ? <Chip label="Container ready" tone="accent" /> : null}
              {config?.directory ? <Chip label={truncateMiddle(config.directory, 42)} tone="neutral" /> : null}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  )
}

function SessionsScreen(props: { navigate(path: string): void }) {
  const { client, config, bootstrap } = useAppContext()
  const [sessions, setSessions] = useState<MobileSessionSummary[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(
    async (term?: string) => {
      if (!client) {
        setSessions([])
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setMessage(null)
        setSessions(await client.listSessions(term?.trim() || undefined))
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setLoading(false)
      }
    },
    [client],
  )

  useEffect(() => {
    const timeout = setTimeout(() => {
      void load(search)
    }, 180)
    return () => clearTimeout(timeout)
  }, [load, search])

  const createSession = useCallback(async () => {
    if (!client || !config) return

    const executionTarget = config.executionTarget ?? "local"
    if (executionTarget === "container" && !bootstrap?.execution.container.available) {
      setMessage(
        "Container sandbox is unavailable on the host. Switch back to local in Settings or restore Docker/Podman.",
      )
      return
    }

    try {
      setCreating(true)
      setMessage(null)
      const session = await client.createSession({
        title: "Web session",
        executionTarget,
      })
      props.navigate(`/app/sessions/${session.id}`)
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }, [bootstrap?.execution.container.available, client, config, props])

  const busyCount = useMemo(() => sessions.filter((item) => item.status?.type === "busy").length, [sessions])
  const retryCount = useMemo(() => sessions.filter((item) => item.status?.type === "retry").length, [sessions])
  const githubCount = useMemo(() => sessions.filter((item) => item.info.github).length, [sessions])
  const containerCount = useMemo(() => sessions.filter((item) => item.info.workspaceID).length, [sessions])

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Operations board"
        title="Track live runs, approvals, and publish readiness."
        description="Search across sessions, jump straight into the active transcript, or open a fresh web session against the currently selected server workspace."
        actions={
          <div className="w-full min-w-[200px] lg:w-auto">
            <Button busy={creating} onClick={() => void createSession()} className="w-full lg:w-auto">
              New session
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Chip label={`${sessions.length} sessions`} tone="accent" />
          <Chip label={`${busyCount} busy`} tone={busyCount ? "accent" : "neutral"} />
          <Chip label={`${retryCount} retry`} tone={retryCount ? "warn" : "neutral"} />
          <Chip label={`${githubCount} GitHub-linked`} tone="neutral" />
          <Chip label={`${containerCount} container`} tone={containerCount ? "accent" : "neutral"} />
          <Chip label={currentProjectLabel(bootstrap?.currentProject)} tone="neutral" />
        </div>
        <div className="mt-4 max-w-xl">
          <Field
            label="Search sessions"
            value={search}
            onChange={setSearch}
            placeholder="Search sessions, repos, or branches"
          />
        </div>
      </Surface>

      {message ? <Banner>{message}</Banner> : null}

      {loading ? (
        <Surface title="Loading sessions">
          <Spinner label="Refreshing session board" />
        </Surface>
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Create your first web session to monitor tool execution, inspect diffs, answer permission prompts, and publish repo-backed work without leaving the browser."
          action={
            <Button busy={creating} onClick={() => void createSession()}>
              Create session
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sessions.map((session) => {
            const summary = session.info.summary
            const changedFiles = (summary?.additions ?? 0) + (summary?.deletions ?? 0)
            const footerLabel =
              session.status?.type === "busy"
                ? "Execution is active and streaming new output"
                : session.status?.type === "retry"
                  ? "Needs attention before the next run can continue"
                  : "Ready for transcript, approvals, and publish review"

            return (
              <button
                key={session.info.id}
                onClick={() => props.navigate(`/app/sessions/${session.info.id}`)}
                className="group relative overflow-hidden rounded-[28px] border border-terminal-border bg-terminal-panel px-5 py-5 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-strong"
              >
                <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-terminal-accent/10 blur-2xl" />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-terminal-muted">
                      <span>Execution</span>
                      <span>Updated {formatRelativeTime(session.info.time.updated)}</span>
                    </div>
                    <div className="break-words text-xl font-semibold text-terminal-text">
                      {session.info.title || "Untitled session"}
                    </div>
                    <div className="break-words text-sm text-terminal-muted">{sessionLocation(session.info)}</div>
                  </div>
                  <StatusPill status={session.status} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Chip label={`${summary?.files ?? 0} files`} tone="neutral" />
                  <Chip
                    label={`+${summary?.additions ?? 0} / -${summary?.deletions ?? 0}`}
                    tone={changedFiles ? "accent" : "neutral"}
                  />
                  {session.info.workspaceID ? <Chip label="Container sandbox" tone="accent" /> : null}
                  {session.info.github ? (
                    <Chip label={session.info.github.repo || session.info.github.fullName} tone="accent" />
                  ) : null}
                </div>
                <div className="mt-4 flex items-center justify-between gap-4 border-t border-terminal-border/70 pt-4 text-sm text-terminal-muted">
                  <span>{footerLabel}</span>
                  <span className="font-semibold uppercase tracking-[0.16em] text-terminal-accent transition group-hover:translate-x-0.5">
                    Open
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PermissionCard(props: {
  item: MobileSessionDetail["permissions"][number]
  onRespond(response: "once" | "always" | "reject"): void
}) {
  const metadata = props.item.metadata ?? {}
  const description = typeof metadata.description === "string" ? metadata.description : ""
  const command = typeof metadata.command === "string" ? metadata.command : ""
  const path =
    typeof metadata.path === "string" ? metadata.path : typeof metadata.file === "string" ? metadata.file : ""

  return (
    <div className="rounded-[28px] border border-terminal-accent/20 bg-terminal-panel px-4 py-4 shadow-soft">
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terminal-accent">
          Permission required
        </div>
        <div className="text-lg font-semibold text-terminal-text">{props.item.permission || "Unknown permission"}</div>
        {description ? <div className="text-sm leading-6 text-terminal-muted">{description}</div> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip label={`${props.item.patterns.length} patterns`} tone="neutral" />
        {props.item.always.length ? <Chip label={`${props.item.always.length} remembered`} tone="accent" /> : null}
        {command ? <Chip label="Command scope" tone="accent" /> : null}
        {path ? <Chip label="Path scoped" tone="neutral" /> : null}
      </div>
      {command ? (
        <pre className="mt-3 overflow-x-auto no-scrollbar whitespace-pre-wrap break-words rounded-2xl border border-terminal-border bg-terminal-code px-3 py-3 font-mono text-xs leading-6 text-terminal-text">
          {command}
        </pre>
      ) : null}
      {path ? <div className="mt-2 break-all text-xs text-terminal-muted">Path: {path}</div> : null}
      {props.item.patterns.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {props.item.patterns.map((pattern) => (
            <Chip key={pattern} label={pattern} tone="neutral" />
          ))}
        </div>
      ) : null}
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <Button variant="danger" onClick={() => props.onRespond("reject")}>
          Reject
        </Button>
        <Button variant="secondary" onClick={() => props.onRespond("once")}>
          Allow once
        </Button>
        <Button onClick={() => props.onRespond("always")}>Always allow</Button>
      </div>
    </div>
  )
}

function DiffViewer(props: { diffs: FileDiff[] }) {
  return (
    <div className="min-w-0 space-y-3">
      {props.diffs.map((diff) => (
        <details
          key={diff.file}
          className="min-w-0 overflow-hidden rounded-2xl border border-terminal-border bg-terminal-code px-4 py-3"
        >
          <summary className="cursor-pointer list-none">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <code className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-terminal-text">
                  {diff.file}
                </code>
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip label={`+${diff.additions}`} tone={diff.additions ? "accent" : "neutral"} />
                <Chip label={`-${diff.deletions}`} tone={diff.deletions ? "warn" : "neutral"} />
              </div>
            </div>
          </summary>
          <div className="mt-4 grid gap-4 2xl:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-terminal-muted">
                Before
              </div>
              <pre className="w-full max-w-full overflow-x-auto no-scrollbar whitespace-pre-wrap break-words rounded-2xl border border-terminal-border/70 bg-terminal-panel px-3 py-3 text-xs leading-6 text-terminal-text">
                {diff.before}
              </pre>
            </div>
            <div className="min-w-0">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-terminal-muted">
                After
              </div>
              <pre className="w-full max-w-full overflow-x-auto no-scrollbar whitespace-pre-wrap break-words rounded-2xl border border-terminal-border/70 bg-terminal-panel px-3 py-3 text-xs leading-6 text-terminal-text">
                {diff.after}
              </pre>
            </div>
          </div>
        </details>
      ))}
    </div>
  )
}

function ToolCard(props: { part: ReturnType<typeof toolParts>[number] }) {
  const state = props.part.state as {
    status: "pending" | "running" | "completed" | "error"
    title?: string
    input?: Record<string, unknown>
    output?: string
    error?: string
  }

  const tone = state.status === "completed" ? "good" : state.status === "error" ? "warn" : "accent"

  return (
    <details className="rounded-2xl border border-terminal-border bg-terminal-code px-4 py-3">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-terminal-text">{props.part.tool}</div>
            {state.title ? <div className="text-xs text-terminal-muted">{state.title}</div> : null}
          </div>
          <Chip label={state.status} tone={tone} />
        </div>
      </summary>
      <div className="mt-4 space-y-3 text-xs">
        {state.input ? (
          <div>
            <div className="mb-2 font-semibold uppercase tracking-[0.16em] text-terminal-muted">Input</div>
            <pre className="overflow-x-auto no-scrollbar rounded-2xl border border-terminal-border/70 bg-terminal-panel px-3 py-3 text-terminal-text whitespace-pre-wrap">
              {safeJson(state.input)}
            </pre>
          </div>
        ) : null}
        {state.output ? (
          <div>
            <div className="mb-2 font-semibold uppercase tracking-[0.16em] text-terminal-muted">Output</div>
            <pre className="overflow-x-auto no-scrollbar rounded-2xl border border-terminal-border/70 bg-terminal-panel px-3 py-3 text-terminal-text whitespace-pre-wrap">
              {state.output}
            </pre>
          </div>
        ) : null}
        {state.error ? <Banner>{state.error}</Banner> : null}
      </div>
    </details>
  )
}

function MessageCard(props: {
  message: MessageWithParts
  diffs?: FileDiff[]
  diffLoaded?: boolean
  diffLoading?: boolean
  onLoadDiff(messageID: string): void
  onReuse(text: string): void
}) {
  const text = messagePlainText(props.message)
  const reasoning = reasoningText(props.message)
  const tools = toolParts(props.message)
  const patch = patchPart(props.message)
  const isUser = props.message.info.role === "user"
  const assistantMessage = !isUser && props.message.info.role === "assistant" ? props.message.info : null
  const assistantError =
    typeof assistantMessage?.error?.data?.message === "string" ? assistantMessage.error.data.message : undefined
  const cost = assistantMessage?.cost ?? 0
  const tokens = assistantMessage ? assistantMessage.tokens.input + assistantMessage.tokens.output : 0

  return (
    <article
      className={cn(
        "min-w-0 rounded-[28px] border px-4 py-4 shadow-soft",
        isUser ? "border-terminal-accent/20 bg-terminal-accent/10" : "border-terminal-border bg-terminal-panel",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terminal-accent">
            {isUser ? "You" : "Nikcli"}
          </div>
          <div className="mt-1 text-xs text-terminal-muted">{formatRelativeTime(props.message.info.time.created)}</div>
          {!isUser && (cost || tokens) ? (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-terminal-muted">
              {cost ? <span>${cost.toFixed(4)}</span> : null}
              {tokens ? <span>{tokens} tokens</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {text ? (
            <Button
              variant="ghost"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  void navigator.clipboard.writeText(text)
                }
              }}
            >
              Copy
            </Button>
          ) : null}
          {text ? (
            <Button variant="ghost" onClick={() => props.onReuse(text)}>
              Reuse
            </Button>
          ) : null}
        </div>
      </div>

      {text ? (
        <pre className="mt-4 overflow-x-auto no-scrollbar whitespace-pre-wrap break-words text-sm leading-7 text-terminal-text">
          {text}
        </pre>
      ) : null}

      {assistantError ? <div className="mt-4 text-sm text-terminal-error">{assistantError}</div> : null}

      {reasoning ? (
        <details className="mt-4 rounded-2xl border border-terminal-border bg-terminal-code px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-terminal-text">Reasoning</summary>
          <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-terminal-muted">{reasoning}</pre>
        </details>
      ) : null}

      {tools.length ? (
        <div className="mt-4 space-y-3">
          {tools.map((tool) => (
            <ToolCard key={tool.id} part={tool} />
          ))}
        </div>
      ) : null}

      {patch ? (
        <div className="mt-4 rounded-2xl border border-terminal-border bg-terminal-code px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="text-sm font-semibold text-terminal-text">Patch ready</div>
              <Chip label={`${patch.files.length} files touched in this step`} tone="neutral" />
            </div>
            {props.diffLoaded ? null : (
              <Button
                variant="secondary"
                busy={props.diffLoading}
                onClick={() => props.onLoadDiff(props.message.info.id)}
              >
                Load diff
              </Button>
            )}
          </div>
          <div className="mt-4 max-h-72 overflow-y-auto no-scrollbar pr-1">
            <div className="grid gap-2 sm:grid-cols-2">
              {patch.files.map((file) => (
                <PathBadge key={file} path={file} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {props.diffs?.length ? (
        <div className="mt-4">
          <DiffViewer diffs={props.diffs} />
        </div>
      ) : null}
    </article>
  )
}

function SessionScreen(props: { sessionId: string; navigate(path: string): void }) {
  const { client, config, save } = useAppContext()
  const [detail, setDetail] = useState<MobileSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [commands, setCommands] = useState<MobileCommand[]>([])
  const [commandsLoading, setCommandsLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [mode, setMode] = useState<"plan" | "code">("code")
  const [sending, setSending] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishTitle, setPublishTitle] = useState("")
  const [publishBody, setPublishBody] = useState("")
  const [commitMessage, setCommitMessage] = useState("")
  const [diffs, setDiffs] = useState<Record<string, FileDiff[]>>({})
  const [diffLoading, setDiffLoading] = useState<Record<string, boolean>>({})
  const [diffLoaded, setDiffLoaded] = useState<Record<string, boolean>>({})
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const orphanPartsRef = useRef<Record<string, MessageWithParts["parts"]>>({})

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setMessage(null)
      setDetail(await client.getSession(props.sessionId))
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [client, props.sessionId])

  const loadCommands = useCallback(async () => {
    if (!client) return
    try {
      setCommandsLoading(true)
      setCommands(await client.listCommands(props.sessionId))
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setCommandsLoading(false)
    }
  }, [client, props.sessionId])

  useEffect(() => {
    void load()
    void loadCommands()
  }, [load, loadCommands])

  useEffect(() => {
    if (!client) return
    const controller = new AbortController()

    void client
      .streamSession({
        sessionID: props.sessionId,
        signal: controller.signal,
        onEvent(event) {
          const nextError = sessionErrorMessage(event)
          if (nextError) {
            setMessage(nextError)
            return
          }
          setDetail((current) => {
            if (!current) return current

            if (event.type === "message.part.updated") {
              const part = event.properties.part
              if ("messageID" in part) {
                const hasMessage = current.messages.some((item) => item.info.id === part.messageID)
                if (!hasMessage) {
                  const existing = orphanPartsRef.current[part.messageID] ?? []
                  const nextParts = [...existing]
                  const index = nextParts.findIndex((item) => item.id === part.id)
                  if (index === -1) nextParts.push(part)
                  else nextParts[index] = part
                  orphanPartsRef.current[part.messageID] = nextParts
                  return current
                }
              }
            }

            const next = reduceSessionDetail(current, event)

            if (event.type === "message.updated") {
              const orphanParts = orphanPartsRef.current[event.properties.info.id]
              if (orphanParts?.length) {
                delete orphanPartsRef.current[event.properties.info.id]
                return {
                  ...next,
                  messages: orphanParts.reduce((messages, part) => upsertPart(messages, part), next.messages),
                }
              }
            }

            return next
          })
        },
        onError(error) {
          if (!controller.signal.aborted) {
            setMessage(error)
          }
        },
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setMessage(getErrorMessage(error))
        }
      })

    return () => controller.abort()
  }, [client, props.sessionId])

  useEffect(() => {
    if (!detail || !transcriptRef.current) return
    requestAnimationFrame(() => {
      const node = transcriptRef.current
      if (!node) return
      node.scrollTop = node.scrollHeight
    })
  }, [detail?.messages.length])

  const hasUserPrompt = useMemo(() => detail?.messages.some((item) => item.info.role === "user") ?? false, [detail])
  const sessionBlocked = detail?.status?.type === "busy" || detail?.status?.type === "retry"
  const cleaned = Boolean(detail?.info.github?.worktree.cleanedAt)
  const slashInput = useMemo(() => parseSlashCommand(input), [input])
  const slashSuggestions = useMemo(() => {
    if (!input.trimStart().startsWith("/")) return []
    const raw = input.trimStart().slice(1).split(/\s+/)[0]?.toLowerCase() ?? ""
    return commands
      .filter((command) => {
        if (!raw) return true
        return (
          command.name.toLowerCase().includes(raw) ||
          command.description?.toLowerCase().includes(raw) ||
          command.hints.some((hint) => hint.toLowerCase().includes(raw))
        )
      })
      .slice(0, 6)
  }, [commands, input])

  const preferredModel = useMemo(
    () =>
      config?.modelProviderID && config?.modelID
        ? {
            providerID: config.modelProviderID,
            modelID: config.modelID,
          }
        : undefined,
    [config?.modelID, config?.modelProviderID],
  )

  const openPublish = useCallback(() => {
    if (!detail?.info.github) return
    setPublishTitle(detail.info.github.pullRequest?.title || detail.info.title)
    setCommitMessage(detail.info.title)
    setPublishBody(
      detail.info.github.pullRequest
        ? `Updated from web session ${detail.info.id}.`
        : `## Summary\n- Generated from web session \`${detail.info.id}\`\n- Base branch: \`${detail.info.github.baseBranch}\`\n- Head branch: \`${detail.info.github.headBranch}\``,
    )
    setPublishOpen(true)
  }, [detail])

  const send = useCallback(async () => {
    if (!client || !detail || !input.trim() || cleaned) return
    try {
      setSending(true)
      setMessage(null)
      if (slashInput) {
        await client.sendCommand(detail.info.id, slashInput.command, slashInput.argumentsText, {
          model: hasUserPrompt ? undefined : preferredModel,
        })
        setInput("")
        return
      }

      const text = input.trim()
      const payload =
        mode === "plan"
          ? `Plan mode: analyze the request, propose the approach, and avoid making changes until explicitly requested.\n\nUser request: ${text}`
          : text
      await client.sendMessage(detail.info.id, payload, hasUserPrompt ? undefined : { model: preferredModel })
      setInput("")
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }, [cleaned, client, detail, hasUserPrompt, input, mode, preferredModel, slashInput])

  const loadDiff = useCallback(
    async (messageId: string) => {
      if (!client || !detail || diffLoaded[messageId] || diffLoading[messageId]) return
      try {
        setDiffLoading((current) => ({ ...current, [messageId]: true }))
        const next = await client.getDiff(detail.info.id, messageId)
        setDiffs((current) => ({ ...current, [messageId]: next }))
        setDiffLoaded((current) => ({ ...current, [messageId]: true }))
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setDiffLoading((current) => ({ ...current, [messageId]: false }))
      }
    },
    [client, detail, diffLoaded, diffLoading],
  )

  const respond = useCallback(
    async (permissionId: string, response: "once" | "always" | "reject") => {
      if (!client || !detail) return
      try {
        await client.respondToPermission(detail.info.id, permissionId, response)
      } catch (error) {
        setMessage(getErrorMessage(error))
      }
    },
    [client, detail],
  )

  const abort = useCallback(async () => {
    if (!client || !detail) return
    try {
      await client.abortSession(detail.info.id)
    } catch (error) {
      setMessage(getErrorMessage(error))
    }
  }, [client, detail])

  const publish = useCallback(async () => {
    if (!client || !detail?.info.github || sessionBlocked || cleaned) return
    try {
      setPublishing(true)
      await client.publishGithubSession(detail.info.id, {
        title: publishTitle.trim() || detail.info.github.pullRequest?.title || detail.info.title,
        body: publishBody.trim() || undefined,
        commitMessage: commitMessage.trim() || detail.info.title,
      })
      setPublishOpen(false)
      await load()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setPublishing(false)
    }
  }, [cleaned, client, commitMessage, detail, load, publishBody, publishTitle, sessionBlocked])

  const cleanup = useCallback(async () => {
    if (!client || !detail?.info.github || sessionBlocked || cleaned) return
    try {
      setCleaning(true)
      await client.cleanupGithubSession(detail.info.id)
      if (config && detail.info.github.repositoryDirectory) {
        save({ ...config, directory: detail.info.github.repositoryDirectory })
      }
      await load()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setCleaning(false)
    }
  }, [cleaned, client, config, detail, load, save, sessionBlocked])

  if (loading && !detail) {
    return (
      <Surface title="Loading session">
        <Spinner label="Fetching transcript and permissions" />
      </Surface>
    )
  }

  if (!detail) {
    return (
      <EmptyState
        title="Session unavailable"
        description="The requested session could not be loaded from the connected Nikcli host."
      />
    )
  }

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Execution timeline"
        title={detail.info.title || "Session"}
        description={sessionLocation(detail.info)}
        actions={
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button className="w-full sm:w-auto" variant="secondary" onClick={() => props.navigate("/app/sessions")}>
              Back
            </Button>
            <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
            {detail.info.github ? (
              <Button
                className="w-full sm:w-auto"
                variant="secondary"
                onClick={openPublish}
                disabled={sessionBlocked || cleaned}
              >
                Publish
              </Button>
            ) : null}
            <Button
              className="w-full sm:w-auto"
              variant="danger"
              onClick={() => void abort()}
              disabled={!sessionBlocked}
            >
              Abort
            </Button>
            {detail.info.github ? (
              <Button
                className="w-full sm:w-auto"
                variant="secondary"
                busy={cleaning}
                onClick={() => void cleanup()}
                disabled={sessionBlocked || cleaned}
              >
                Cleanup
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <StatusPill status={detail.status} />
          {detail.info.github?.fullName ? <Chip label={detail.info.github.fullName} tone="accent" /> : null}
          {detail.info.github?.baseBranch ? (
            <Chip label={`base ${detail.info.github.baseBranch}`} tone="neutral" />
          ) : null}
          {detail.info.github?.headBranch ? (
            <Chip label={`head ${detail.info.github.headBranch}`} tone="neutral" />
          ) : null}
          {detail.info.workspaceID ? <Chip label="Container workspace" tone="accent" /> : null}
          {cleaned ? <Chip label="Worktree cleaned" tone="warn" /> : null}
          <Chip label={`Updated ${formatRelativeTime(detail.info.time.updated)}`} tone="neutral" />
        </div>
        {detail.info.github?.pullRequest ? (
          <div className="mt-4 rounded-2xl border border-terminal-border bg-terminal-code px-4 py-3 text-sm text-terminal-text">
            Pull request:{" "}
            <a
              className="font-semibold text-terminal-accent underline"
              href={detail.info.github.pullRequest.url}
              target="_blank"
              rel="noreferrer"
            >
              {detail.info.github.pullRequest.title}
            </a>
          </div>
        ) : null}
      </Surface>

      {message ? <Banner>{message}</Banner> : null}

      {detail.permissions.length ? (
        <div className="space-y-3">
          {detail.permissions.map((item) => (
            <PermissionCard key={item.id} item={item} onRespond={(response) => void respond(item.id, response)} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.38fr)_minmax(340px,0.92fr)] xl:items-start">
        <Surface
          title="Transcript"
          description="Live output, tool activity, reasoning, and diffs stream into this timeline from the same mobile session route."
          className="xl:min-h-[calc(100vh-18rem)]"
        >
          <div ref={transcriptRef} className="space-y-4 xl:max-h-[calc(100vh-24rem)] xl:overflow-y-auto no-scrollbar xl:pr-1">
            {detail.messages.length === 0 ? (
              <EmptyState
                title="No transcript yet"
                description="Send the first instruction to start this execution timeline."
              />
            ) : (
              detail.messages.map((entry) => (
                <MessageCard
                  key={entry.info.id}
                  message={entry}
                  diffs={diffs[entry.info.id]}
                  diffLoaded={Boolean(diffLoaded[entry.info.id])}
                  diffLoading={Boolean(diffLoading[entry.info.id])}
                  onLoadDiff={loadDiff}
                  onReuse={(text) => setInput(text)}
                />
              ))
            )}
          </div>
        </Surface>

        <div className="space-y-6 xl:sticky xl:top-6">
          <Surface
            eyebrow="Composer"
            title="Send the next instruction"
            description="Use plain prompts or slash commands. The first send can optionally force your chosen local model preference before the transcript has user context."
          >
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button
                className="w-full sm:w-auto"
                variant={mode === "code" ? "primary" : "secondary"}
                onClick={() => setMode("code")}
              >
                Code
              </Button>
              <Button
                className="w-full sm:w-auto"
                variant={mode === "plan" ? "primary" : "secondary"}
                onClick={() => setMode("plan")}
              >
                Plan
              </Button>
              <Chip
                label={cleaned ? "Session cleaned" : sessionBlocked ? "Busy" : "Ready"}
                tone={cleaned ? "warn" : sessionBlocked ? "accent" : "good"}
              />
            </div>
            <div className="mt-4 space-y-3">
              <TextAreaField
                label="Instruction"
                value={input}
                onChange={setInput}
                rows={5}
                placeholder="Ask Nikcli to inspect, implement, review, or publish work..."
              />
              {input.trimStart().startsWith("/") ? (
                <div className="rounded-2xl border border-terminal-border bg-terminal-code px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted">
                      Slash suggestions
                    </div>
                    {commandsLoading ? <Spinner /> : null}
                  </div>
                  <div className="max-h-44 overflow-y-auto no-scrollbar">
                    <div className="flex flex-wrap gap-2">
                      {slashSuggestions.length ? (
                        slashSuggestions.map((command) => (
                          <button
                            key={command.name}
                            onClick={() => {
                              const current = input.trimStart()
                              const match = current.match(/^\/([^\s]+)(.*)$/s)
                              const remainder = match?.[2] ?? ""
                              const nextRemainder =
                                remainder.startsWith(" ") || remainder === "" ? remainder : ` ${remainder}`
                              setInput(`/${command.name}${nextRemainder || " "}`)
                            }}
                            className="rounded-full border border-terminal-border bg-terminal-panel px-3 py-2 text-xs font-semibold text-terminal-text hover:border-terminal-accent/30 hover:text-terminal-accent"
                          >
                            /{command.name}
                          </button>
                        ))
                      ) : (
                        <div className="text-sm text-terminal-muted">No matching commands found for this session.</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 sm:flex sm:flex-wrap">
                <Button
                  className="w-full sm:w-auto"
                  busy={sending}
                  disabled={!input.trim() || cleaned}
                  onClick={() => void send()}
                >
                  Send
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  variant="secondary"
                  onClick={() => setInput("")}
                  disabled={!input.trim()}
                >
                  Clear draft
                </Button>
              </div>
            </div>
          </Surface>
        </div>
      </div>

      <Modal open={publishOpen} title="Publish GitHub session" onClose={() => setPublishOpen(false)}>
        <div className="space-y-4">
          <Field label="Pull request title" value={publishTitle} onChange={setPublishTitle} />
          <Field label="Commit message" value={commitMessage} onChange={setCommitMessage} />
          <TextAreaField label="Pull request body" value={publishBody} onChange={setPublishBody} rows={8} />
          <div className="flex flex-wrap gap-3">
            <Button busy={publishing} onClick={() => void publish()}>
              Publish branch and PR
            </Button>
            <Button variant="secondary" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function ReposScreen(props: { navigate(path: string): void }) {
  const { client, config, bootstrap, save } = useAppContext()
  const [projects, setProjects] = useState<MobileProject[]>([])
  const [repos, setRepos] = useState<GithubRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [sandboxName, setSandboxName] = useState("")
  const [busy, setBusy] = useState(false)
  const [importingRepo, setImportingRepo] = useState<string | null>(null)
  const [branchRepo, setBranchRepo] = useState<string | null>(null)
  const [branchLoading, setBranchLoading] = useState<string | null>(null)
  const [startingRepo, setStartingRepo] = useState<string | null>(null)
  const [branchOptions, setBranchOptions] = useState<Record<string, MobileGithubBranch[]>>({})
  const [baseBranchByRepo, setBaseBranchByRepo] = useState<Record<string, string>>({})
  const [sessionTitleByRepo, setSessionTitleByRepo] = useState<Record<string, string>>({})
  const [repoSearch, setRepoSearch] = useState("")

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setMessage(null)
      const [projectList, githubRepos] = await Promise.all([
        client.listProjects(),
        client.listGithubRepos().catch(() => []),
      ])
      setProjects(projectList)
      setRepos(githubRepos as GithubRepo[])
      setBaseBranchByRepo((current) => {
        const next = { ...current }
        for (const repo of githubRepos as GithubRepo[]) {
          const fullName = repo.full_name || repo.name
          if (!next[fullName]) next[fullName] = repo.default_branch || "main"
        }
        return next
      })
      setSessionTitleByRepo((current) => {
        const next = { ...current }
        for (const repo of githubRepos as GithubRepo[]) {
          const fullName = repo.full_name || repo.name
          if (!next[fullName]) next[fullName] = `${fullName} ${repo.default_branch || "main"}`
        }
        return next
      })
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const selectedDirectory = config?.directory
  const executionTarget = config?.executionTarget ?? "local"
  const containerReady = Boolean(bootstrap?.execution.container.available)

  const selectedProject = useMemo(
    () =>
      projects.find((project) => {
        const sandboxes = Array.isArray(project.sandboxes) ? project.sandboxes : []
        return project.worktree === selectedDirectory || sandboxes.includes(selectedDirectory || "")
      }),
    [projects, selectedDirectory],
  )

  const visibleRepos = useMemo(() => {
    const term = repoSearch.trim().toLowerCase()
    if (!term) return repos
    return repos.filter((repo) =>
      [repo.full_name || repo.name || "", repo.language || "", repo.description || ""].some((value) =>
        value.toLowerCase().includes(term),
      ),
    )
  }, [repoSearch, repos])

  const selectedRepo = useMemo(
    () => repos.find((repo) => (repo.full_name || repo.name) === branchRepo) ?? null,
    [branchRepo, repos],
  )

  const selectProject = useCallback(
    (project: MobileProject) => {
      if (!config) return
      save({ ...config, directory: project.worktree })
    },
    [config, save],
  )

  const createSandbox = useCallback(async () => {
    if (!client || !config) return
    try {
      setBusy(true)
      const worktree = await client.createWorktree(sandboxName.trim() || undefined)
      save({ ...config, directory: worktree.directory })
      setSandboxName("")
      await load()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [client, config, load, sandboxName, save])

  const useImportedRepo = useCallback(
    (repo: GithubRepo) => {
      if (!config || !repo.imported_directory) return
      save({ ...config, directory: repo.imported_directory })
    },
    [config, save],
  )

  const importRepo = useCallback(
    async (repo: GithubRepo) => {
      if (!client || !config || !repo.clone_url) return
      if (executionTarget === "container" && !containerReady) {
        setMessage("Container sandbox requires Docker or Podman on the server. Switch back to local in Settings.")
        return
      }
      const owner = safeOwner(repo.full_name)
      if (!owner) {
        setMessage("Invalid repository owner")
        return
      }

      try {
        setImportingRepo(repo.full_name)
        const result = await client.importGithubRepo({
          owner,
          repo: repo.name,
          cloneUrl: repo.clone_url,
          defaultBranch: repo.default_branch || "main",
          private: repo.private,
        })
        save({ ...config, directory: result.import.directory })
        await load()
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setImportingRepo(null)
      }
    },
    [client, config, containerReady, executionTarget, load, save],
  )

  const loadBranches = useCallback(
    async (repo: GithubRepo) => {
      if (!client) return
      const owner = safeOwner(repo.full_name)
      if (!owner) {
        setMessage("Invalid repository owner")
        return
      }

      try {
        setBranchLoading(repo.full_name)
        const branches = await client.listGithubBranches(owner, repo.name)
        setBranchOptions((current) => ({ ...current, [repo.full_name]: branches }))
        setBaseBranchByRepo((current) => ({
          ...current,
          [repo.full_name]: current[repo.full_name] || branches[0]?.name || repo.default_branch || "main",
        }))
        setSessionTitleByRepo((current) => ({
          ...current,
          [repo.full_name]: current[repo.full_name] || `${repo.full_name} ${repo.default_branch || "main"}`,
        }))
        setBranchRepo(repo.full_name)
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setBranchLoading(null)
      }
    },
    [client],
  )

  const startGithubSession = useCallback(
    async (repo: GithubRepo) => {
      if (!client || !config || !repo.clone_url) return
      const owner = safeOwner(repo.full_name)
      if (!owner) {
        setMessage("Invalid repository owner")
        return
      }

      try {
        setStartingRepo(repo.full_name)
        const baseBranch = baseBranchByRepo[repo.full_name]?.trim() || repo.default_branch || "main"
        const result = await client.createGithubSession({
          owner,
          repo: repo.name,
          cloneUrl: repo.clone_url,
          htmlUrl: repo.html_url,
          defaultBranch: repo.default_branch || "main",
          baseBranch,
          private: repo.private,
          title: sessionTitleByRepo[repo.full_name]?.trim() || `${repo.full_name} ${baseBranch}`,
          executionTarget,
        })
        save({ ...config, directory: result.worktree.directory })
        props.navigate(`/app/sessions/${result.session.id}`)
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setStartingRepo(null)
      }
    },
    [baseBranchByRepo, client, config, executionTarget, props, save, sessionTitleByRepo],
  )

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Workspace portfolio"
        title="Direct sandboxes and source repos from the browser."
        description="Create disposable worktrees, import GitHub repos into the hosted server, choose the base branch, and launch a PR-ready execution session without changing the backend architecture."
      >
        <div className="flex flex-wrap gap-2">
          <Chip label={`${projects.length} server repos`} tone="accent" />
          <Chip label={`${repos.length} GitHub repos`} tone="neutral" />
          <Chip label={currentProjectLabel(selectedProject)} tone="neutral" />
          <Chip
            label={executionTarget === "container" ? "GitHub target: container" : "GitHub target: local"}
            tone="accent"
          />
          {bootstrap?.github.user?.login ? <Chip label={`@${bootstrap.github.user.login}`} tone="good" /> : null}
        </div>
      </Surface>

      {message ? <Banner>{message}</Banner> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="space-y-6">
          <Surface
            eyebrow="New sandbox"
            title="Create a disposable execution branch"
            description="Provision a fresh server worktree before you start a new task, so session history and publish flow stay isolated."
          >
            <div className="space-y-4">
              <Field
                label="Sandbox name"
                value={sandboxName}
                onChange={setSandboxName}
                placeholder="Optional sandbox name"
              />
              <div className="flex flex-wrap gap-3">
                <Button busy={busy} onClick={() => void createSandbox()}>
                  Create sandbox
                </Button>
              </div>
              {selectedProject ? (
                <div className="text-xs text-terminal-muted">Current repo: {selectedProject.worktree}</div>
              ) : null}
            </div>
          </Surface>

          <Surface
            eyebrow="Server repos"
            title="Select the current workspace"
            description="These are the repos and sandboxes visible to the connected Nikcli host."
          >
            {loading ? (
              <Spinner label="Loading server repos" />
            ) : projects.length === 0 ? (
              <EmptyState
                title="No server repos yet"
                description="Point the server at a workspace, import a repository, or create a sandbox to seed the hosted portfolio."
              />
            ) : (
              <div className="space-y-3">
                {projects.map((project) => {
                  const selected = selectedDirectory === project.worktree
                  return (
                    <button
                      key={project.id}
                      onClick={() => selectProject(project)}
                      className={cn(
                        "w-full rounded-[24px] border px-4 py-4 text-left shadow-soft transition",
                        selected
                          ? "border-terminal-accent/20 bg-terminal-accent/10"
                          : "border-terminal-border bg-terminal-panel hover:bg-surface-hover",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-terminal-text">{currentProjectLabel(project)}</div>
                          <div className="mt-1 text-xs text-terminal-muted">{project.worktree}</div>
                        </div>
                        <Chip label={selected ? "Selected" : "Available"} tone={selected ? "accent" : "neutral"} />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </Surface>
        </div>

        <div className="space-y-6">
          {!bootstrap?.github.connected ? (
            <EmptyState
              title="Connect GitHub first"
              description="Open Settings to enable GitHub OAuth or save a GitHub token, then come back here to browse repositories and launch branch-native sessions."
              action={<Button onClick={() => props.navigate("/app/settings")}>Open settings</Button>}
            />
          ) : (
            <>
              <Surface
                eyebrow="Source control"
                title="Browse and launch branch sessions"
                description="Search your GitHub inventory, choose the base branch, and create an isolated worktree session ready to publish back as a pull request."
              >
                <Field
                  label="Search repositories"
                  value={repoSearch}
                  onChange={setRepoSearch}
                  placeholder="Search repositories, languages, or descriptions"
                />
                <div className="mt-3 text-xs leading-6 text-terminal-muted">
                  {executionTarget === "container"
                    ? containerReady
                      ? "New GitHub sessions keep the same server worktree flow but execute inside a same-server container sandbox."
                      : "Container mode is selected, but the server has no Docker or Podman runtime available right now."
                    : "New GitHub sessions use the current server worktree flow for execution and publish."}
                </div>
              </Surface>

              {selectedRepo ? (
                <Surface
                  eyebrow="Guided launch"
                  title={selectedRepo.full_name}
                  description="Lock the base branch, name the execution track, and launch a GitHub session with a dedicated worktree and publish path."
                >
                  <div className="flex flex-wrap gap-2">
                    <Chip label="1. Repo selected" tone="accent" />
                    <Chip label="2. Choose branch" tone="neutral" />
                    <Chip label="3. Launch session" tone="neutral" />
                    <Chip
                      label={executionTarget === "container" ? "Container sandbox" : "Local worktree"}
                      tone="accent"
                    />
                  </div>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <Field
                      label="Session title"
                      value={
                        sessionTitleByRepo[selectedRepo.full_name] ??
                        `${selectedRepo.full_name} ${selectedRepo.default_branch || "main"}`
                      }
                      onChange={(value) =>
                        setSessionTitleByRepo((current) => ({
                          ...current,
                          [selectedRepo.full_name]: value,
                        }))
                      }
                    />
                    <Field
                      label="Base branch"
                      value={baseBranchByRepo[selectedRepo.full_name] ?? (selectedRepo.default_branch || "main")}
                      onChange={(value) =>
                        setBaseBranchByRepo((current) => ({
                          ...current,
                          [selectedRepo.full_name]: value,
                        }))
                      }
                    />
                  </div>
                  {branchOptions[selectedRepo.full_name]?.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {branchOptions[selectedRepo.full_name].slice(0, 10).map((branch) => {
                        const active =
                          (baseBranchByRepo[selectedRepo.full_name] ?? (selectedRepo.default_branch || "main")) ===
                          branch.name
                        return (
                          <Button
                            key={branch.name}
                            variant={active ? "primary" : "secondary"}
                            onClick={() =>
                              setBaseBranchByRepo((current) => ({
                                ...current,
                                [selectedRepo.full_name]: branch.name,
                              }))
                            }
                          >
                            {branch.name}
                          </Button>
                        )
                      })}
                    </div>
                  ) : null}
                  <div className="mt-4 rounded-2xl border border-terminal-border bg-terminal-code px-4 py-4 text-sm leading-6 text-terminal-text">
                    <div>
                      Worktree source: {selectedRepo.full_name} from{" "}
                      {baseBranchByRepo[selectedRepo.full_name] ?? (selectedRepo.default_branch || "main")}.
                    </div>
                    <div>
                      Session title:{" "}
                      {sessionTitleByRepo[selectedRepo.full_name] ??
                        `${selectedRepo.full_name} ${selectedRepo.default_branch || "main"}`}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button
                      busy={startingRepo === selectedRepo.full_name}
                      onClick={() => void startGithubSession(selectedRepo)}
                    >
                      Launch GitHub session
                    </Button>
                    <Button variant="secondary" onClick={() => setBranchRepo(null)}>
                      Close launch guide
                    </Button>
                  </div>
                </Surface>
              ) : null}

              <Surface
                eyebrow="GitHub inventory"
                title="Repository list"
                description="Imported repos can be reused instantly. Other repos can be imported or opened into a dedicated session flow."
              >
                {loading ? (
                  <Spinner label="Loading GitHub repositories" />
                ) : visibleRepos.length === 0 ? (
                  <EmptyState
                    title="No repositories matched"
                    description="Adjust the search query or verify the GitHub account connected on the Nikcli host."
                  />
                ) : (
                  <div className="space-y-3">
                    {visibleRepos.map((repo) => {
                      const fullName = repo.full_name || repo.name
                      const imported = Boolean(repo.imported_directory)
                      return (
                        <div
                          key={fullName}
                          className="rounded-[24px] border border-terminal-border bg-terminal-panel px-4 py-4 shadow-soft"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <Chip label={repo.private ? "Private" : "Public"} tone="neutral" />
                                {repo.language ? <Chip label={repo.language} tone="neutral" /> : null}
                                {imported ? <Chip label="Imported" tone="good" /> : null}
                              </div>
                              <div className="break-words text-lg font-semibold text-terminal-text">{fullName}</div>
                              {repo.description ? (
                                <div className="text-sm leading-6 text-terminal-muted">{repo.description}</div>
                              ) : null}
                              <div className="text-xs text-terminal-muted">
                                Default branch: {repo.default_branch || "main"}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {imported ? (
                                <Button variant="secondary" onClick={() => useImportedRepo(repo)}>
                                  Use imported repo
                                </Button>
                              ) : null}
                              {repo.clone_url ? (
                                <Button
                                  variant="secondary"
                                  busy={importingRepo === fullName}
                                  onClick={() => void importRepo(repo)}
                                >
                                  {imported ? "Refresh import" : "Import repo"}
                                </Button>
                              ) : null}
                              <Button
                                variant="secondary"
                                busy={branchLoading === fullName}
                                onClick={() => void loadBranches(repo)}
                              >
                                Choose branch
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Surface>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsScreen() {
  const { client, config, bootstrap, save, clear, refreshBootstrap } = useAppContext()
  const [url, setUrl] = useState(config?.url ?? "")
  const [token, setToken] = useState(config?.token ?? "")
  const [directory, setDirectory] = useState(config?.directory ?? "")
  const [executionTarget, setExecutionTarget] = useState<MobileExecutionTarget>(config?.executionTarget ?? "local")
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | null>(null)
  const [providerLoading, setProviderLoading] = useState(false)
  const [selectedProviderID, setSelectedProviderID] = useState(config?.modelProviderID ?? "")
  const [selectedModelID, setSelectedModelID] = useState(config?.modelID ?? "")
  const [showBearerToken, setShowBearerToken] = useState(false)
  const [githubToken, setGithubToken] = useState("")
  const [showGithubToken, setShowGithubToken] = useState(false)
  const [oauthFlow, setOauthFlow] = useState<MobileGithubDeviceAuthStart | null>(null)
  const [oauthBusy, setOauthBusy] = useState(false)
  const [tokens, setTokens] = useState<MobileAuthTokenPublic[]>([])
  const [tokenName, setTokenName] = useState("web")
  const [tokenDays, setTokenDays] = useState("30")
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tokenBusy, setTokenBusy] = useState(false)
  const authRun = useRef(0)

  useEffect(() => {
    setUrl(config?.url ?? "")
    setToken(config?.token ?? "")
    setDirectory(config?.directory ?? "")
    setExecutionTarget(config?.executionTarget ?? "local")
    setSelectedProviderID(config?.modelProviderID ?? "")
    setSelectedModelID(config?.modelID ?? "")
  }, [config])

  const loadProviders = useCallback(async () => {
    if (!client) return
    try {
      setProviderLoading(true)
      const catalog = await client.listProviders()
      setProviderCatalog(catalog)
      const nextProvider = providerFallback(catalog, config?.modelProviderID)
      const nextModel = modelFallback(catalog, nextProvider, config?.modelID)
      if (nextProvider) setSelectedProviderID(nextProvider)
      if (nextModel) setSelectedModelID(nextModel)
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setProviderLoading(false)
    }
  }, [client, config?.modelID, config?.modelProviderID])

  const loadTokens = useCallback(async () => {
    if (!client) return
    try {
      setTokens(await client.listAuthTokens())
    } catch (error) {
      setMessage(getErrorMessage(error))
    }
  }, [client])

  useEffect(() => {
    void loadProviders()
    void loadTokens()
  }, [loadProviders, loadTokens])

  useEffect(() => {
    if (!providerCatalog || !selectedProviderID) return
    const nextModel = modelFallback(providerCatalog, selectedProviderID, selectedModelID)
    if (nextModel && nextModel !== selectedModelID) {
      setSelectedModelID(nextModel)
    }
  }, [providerCatalog, selectedModelID, selectedProviderID])

  useEffect(() => {
    return () => {
      authRun.current += 1
    }
  }, [])

  const providerOptions = useMemo(
    () =>
      providerCatalog?.all.map((provider) => ({
        value: provider.id,
        label: `${provider.name} (${provider.id})`,
      })) ?? [],
    [providerCatalog],
  )

  const modelOptions = useMemo(() => {
    const provider = providerCatalog?.all.find((item) => item.id === selectedProviderID)
    if (!provider) return []
    return Object.values(provider.models).map((model) => ({
      value: model.id,
      label: `${model.name} (${model.id})`,
    }))
  }, [providerCatalog, selectedProviderID])

  const saveConnection = useCallback(async () => {
    const rawUrl = url.trim()
    if (!rawUrl) {
      setMessage("Server URL is required")
      return
    }
    if (executionTarget === "container" && !bootstrap?.execution.container.available) {
      setMessage("Container sandbox requires Docker or Podman on the server")
      return
    }

    try {
      setSaving(true)
      setMessage(null)
      const next: AppServerConfig = {
        ...config,
        url: normalizeServerUrl(rawUrl),
        token: token.trim() || undefined,
        directory: directory.trim() || undefined,
        executionTarget,
        modelProviderID: selectedProviderID || undefined,
        modelID: selectedModelID || undefined,
      }
      const testClient = new WebNikcliClient(next)
      await testClient.bootstrap()
      save(next)
      setMessage("Connection updated")
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }, [
    bootstrap?.execution.container.available,
    config,
    directory,
    executionTarget,
    save,
    selectedModelID,
    selectedProviderID,
    token,
    url,
  ])

  const startDeviceFlow = useCallback(async () => {
    if (!client) return
    try {
      setOauthBusy(true)
      setMessage(null)
      const currentRun = ++authRun.current
      const flow = await client.startGithubDeviceAuth()
      setOauthFlow(flow)
      window.open(flow.verificationUriComplete || flow.verificationUri, "_blank", "noopener,noreferrer")

      let nextInterval = flow.interval
      while (authRun.current === currentRun) {
        await sleep(nextInterval * 1000)
        const result = await client.pollGithubDeviceAuth(flow.deviceCode)
        if (result.status === "pending") {
          nextInterval = result.interval ?? flow.interval
          continue
        }
        if (result.status === "approved") {
          await refreshBootstrap()
          setMessage(result.user?.login ? `GitHub connected as @${result.user.login}` : "GitHub connected")
          setOauthFlow(null)
          break
        }
        setOauthFlow(null)
        setMessage(
          result.status === "denied"
            ? "GitHub device flow was denied"
            : result.status === "expired"
              ? "GitHub device flow expired"
              : "GitHub device flow stopped",
        )
        break
      }
    } catch (error) {
      setMessage(getErrorMessage(error))
      setOauthFlow(null)
    } finally {
      setOauthBusy(false)
    }
  }, [client, refreshBootstrap])

  const saveGithubToken = useCallback(async () => {
    if (!client || !githubToken.trim()) return
    try {
      await client.setGithubToken(githubToken.trim())
      setGithubToken("")
      await refreshBootstrap()
      setMessage("GitHub token saved on the host")
    } catch (error) {
      setMessage(getErrorMessage(error))
    }
  }, [client, githubToken, refreshBootstrap])

  const clearGithub = useCallback(async () => {
    if (!client) return
    try {
      await client.clearGithubToken()
      await refreshBootstrap()
      setMessage("GitHub auth removed from the host")
    } catch (error) {
      setMessage(getErrorMessage(error))
    }
  }, [client, refreshBootstrap])

  const createToken = useCallback(async () => {
    if (!client) return
    try {
      setTokenBusy(true)
      const expiry = Number.parseInt(tokenDays, 10)
      const result = await client.createAuthToken(
        tokenName.trim() || "web",
        Number.isFinite(expiry) ? expiry : undefined,
      )
      setCreatedToken(result.token)
      await loadTokens()
      await refreshBootstrap()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setTokenBusy(false)
    }
  }, [client, loadTokens, refreshBootstrap, tokenDays, tokenName])

  const revokeToken = useCallback(
    async (id: string) => {
      if (!client) return
      try {
        await client.revokeAuthToken(id)
        await loadTokens()
        await refreshBootstrap()
      } catch (error) {
        setMessage(getErrorMessage(error))
      }
    },
    [client, loadTokens, refreshBootstrap],
  )

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Connection + defaults"
        title="Tune the web control plane"
        description="These browser-side preferences mirror the mobile connection model: server URL, Bearer token, default directory, execution target, and first-send model preference."
      >
        <div className="flex flex-wrap gap-2">
          <Chip label={bootstrap ? "Connected" : "Disconnected"} tone={bootstrap ? "good" : "warn"} />
          {bootstrap?.auth.currentToken?.name ? (
            <Chip label={`Token ${bootstrap.auth.currentToken.name}`} tone="accent" />
          ) : null}
          {bootstrap?.github.connected ? (
            <Chip label={`GitHub @${bootstrap.github.user?.login ?? "connected"}`} tone="good" />
          ) : null}
          {config?.directory ? <Chip label={truncateMiddle(config.directory, 42)} tone="neutral" /> : null}
        </div>
      </Surface>

      {message ? <Banner>{message}</Banner> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Surface
            eyebrow="Server"
            title="Connection settings"
            description="Validate and save the current Railway or headless server endpoint for this browser."
          >
            <div className="space-y-4">
              <Field
                label="Server URL"
                value={url}
                onChange={setUrl}
                placeholder="https://nikcli-mobile-production.up.railway.app"
              />
              <Field
                label="Bearer token"
                value={token}
                onChange={setToken}
                type={showBearerToken ? "text" : "password"}
                placeholder="nkm_..."
                autoComplete="off"
                spellCheck={false}
                action={
                  <Button variant="secondary" onClick={() => setShowBearerToken((current) => !current)}>
                    {showBearerToken ? "Hide" : "Show"}
                  </Button>
                }
              />
              <Field
                label="Default directory"
                value={directory}
                onChange={setDirectory}
                placeholder="Optional repo or worktree path"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <Button
                  variant={executionTarget === "local" ? "primary" : "secondary"}
                  onClick={() => setExecutionTarget("local")}
                >
                  Local execution
                </Button>
                <Button
                  variant={executionTarget === "container" ? "primary" : "secondary"}
                  onClick={() => setExecutionTarget("container")}
                >
                  Container execution
                </Button>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button busy={saving} onClick={() => void saveConnection()}>
                  Save connection
                </Button>
                <Button variant="danger" onClick={() => clear()}>
                  Clear saved connection
                </Button>
              </div>
            </div>
          </Surface>

          <Surface
            eyebrow="Models"
            title="First-send model preference"
            description="When a brand-new transcript has no user context yet, the web UI can nudge the first send toward your chosen provider and model."
          >
            {providerLoading ? (
              <Spinner label="Loading provider catalog" />
            ) : providerCatalog ? (
              <div className="space-y-4">
                <SelectField
                  label="Provider"
                  value={selectedProviderID}
                  onChange={setSelectedProviderID}
                  options={providerOptions}
                  disabled={!providerOptions.length}
                />
                <SelectField
                  label="Model"
                  value={selectedModelID}
                  onChange={setSelectedModelID}
                  options={modelOptions}
                  disabled={!modelOptions.length}
                />
              </div>
            ) : (
              <div className="text-sm text-terminal-muted">
                Provider catalog is unavailable until the host connection is valid.
              </div>
            )}
          </Surface>
        </div>

        <div className="space-y-6">
          <Surface
            eyebrow="GitHub"
            title="Host-side GitHub access"
            description="Drive the same GitHub repo browser, worktree launch, publish, and cleanup flows exposed through the mobile API."
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Chip
                  label={bootstrap?.github.connected ? "GitHub connected" : "GitHub not connected"}
                  tone={bootstrap?.github.connected ? "good" : "warn"}
                />
                {bootstrap?.github.user?.login ? (
                  <Chip label={`@${bootstrap.github.user.login}`} tone="accent" />
                ) : null}
                {bootstrap?.github.oauthDeviceConfigured ? <Chip label="Device OAuth ready" tone="accent" /> : null}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button busy={oauthBusy} onClick={() => void startDeviceFlow()}>
                  Start device flow
                </Button>
                <Button variant="secondary" onClick={() => void clearGithub()}>
                  Remove GitHub auth
                </Button>
              </div>
              {oauthFlow ? (
                <div className="rounded-2xl border border-terminal-border bg-terminal-code px-4 py-4 text-sm leading-6 text-terminal-text">
                  <div className="font-semibold">Device code: {oauthFlow.userCode}</div>
                  <div className="mt-2">
                    Verification URL:{" "}
                    <a
                      className="text-terminal-accent underline"
                      href={oauthFlow.verificationUriComplete || oauthFlow.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {oauthFlow.verificationUriComplete || oauthFlow.verificationUri}
                    </a>
                  </div>
                </div>
              ) : null}
              <Field
                label="Manual GitHub token"
                value={githubToken}
                onChange={setGithubToken}
                type={showGithubToken ? "text" : "password"}
                placeholder="ghp_..."
                autoComplete="off"
                spellCheck={false}
                action={
                  <Button variant="secondary" onClick={() => setShowGithubToken((current) => !current)}>
                    {showGithubToken ? "Hide" : "Show"}
                  </Button>
                }
              />
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void saveGithubToken()} disabled={!githubToken.trim()}>
                  Save host token
                </Button>
              </div>
            </div>
          </Surface>

          <Surface
            eyebrow="Pairing tokens"
            title="Manage mobile/web Bearer tokens"
            description="Create another long-lived token, reveal it once, and revoke old pairings without touching the backend package."
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-4">
                <Field label="Token name" value={tokenName} onChange={setTokenName} placeholder="web" />
                <Field label="Expiry days" value={tokenDays} onChange={setTokenDays} placeholder="30" />
                <Button busy={tokenBusy} onClick={() => void createToken()}>
                  Create token
                </Button>
                {createdToken ? (
                  <Banner tone="good">
                    New token: <code>{createdToken}</code>
                  </Banner>
                ) : null}
              </div>
              <div className="space-y-3">
                {tokens.length === 0 ? (
                  <div className="text-sm text-terminal-muted">No bearer tokens are stored on the host.</div>
                ) : (
                  tokens.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-terminal-border bg-terminal-code px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-all font-semibold text-terminal-text">{item.name || item.id}</div>
                          <div className="mt-1 text-xs text-terminal-muted">
                            Created {formatRelativeTime(item.createdAt)}
                          </div>
                          {item.lastUsedAt ? (
                            <div className="text-xs text-terminal-muted">
                              Last used {formatRelativeTime(item.lastUsedAt)}
                            </div>
                          ) : null}
                        </div>
                        <Button variant="danger" onClick={() => void revokeToken(item.id)}>
                          Revoke
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Surface>
        </div>
      </div>
    </div>
  )
}

function ClientApp(props: { initialPath: string }) {
  const { configReady, config, bootstrap, bootstrapLoading, bootstrapError } = useAppContext()
  const { theme, toggleTheme } = useThemeMode()
  const { route, navigate } = useAppRouter(props.initialPath)

  useEffect(() => {
    if (!configReady) return
    if (route.screen === "root") {
      navigate(config ? "/app/sessions" : "/app/connect", { replace: true })
      return
    }
    if (!config && route.screen !== "connect") {
      navigate("/app/connect", { replace: true })
    }
  }, [config, configReady, navigate, route.screen])

  const activeRoute = useMemo<AppRoute>(() => {
    if (route.screen === "root") return config ? { screen: "sessions" } : { screen: "connect" }
    if (!config && route.screen !== "connect") return { screen: "connect" }
    return route
  }, [config, route])

  const activeLabel =
    activeRoute.screen === "session"
      ? "Session"
      : activeRoute.screen === "sessions"
        ? "Sessions"
        : activeRoute.screen === "repos"
          ? "Repos"
          : activeRoute.screen === "settings"
            ? "Settings"
            : "Connect"

  const contentWidthClass = activeRoute.screen === "connect" ? "max-w-[74rem]" : "max-w-full"

  return (
    <main id="main-content" className="relative min-h-screen flex-1 overflow-hidden bg-terminal-bg outline-none">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-terminal-accent/5 dark:from-white/[0.03] dark:to-terminal-accent/[0.04]" />
      <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full bg-terminal-accent/10 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-20 h-72 w-72 rounded-full bg-terminal-border/50 blur-3xl dark:bg-terminal-accent/5" />

      <div className="relative mx-auto flex w-full max-w-[var(--app-max)] flex-col gap-4 px-[var(--page-gutter)] py-4 xl:grid xl:min-h-screen xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-6 xl:px-6">
        <aside className="relative rounded-[28px] border border-terminal-border bg-terminal-panel/85 p-4 shadow-strong backdrop-blur sm:p-5 xl:sticky xl:top-[calc(var(--topbar-height)+1rem)] xl:z-20 xl:h-[calc(100vh-var(--topbar-height)-2rem)] xl:overflow-y-auto no-scrollbar">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-terminal-accent">
                Nikcli Web
              </div>
              <div className="mt-1 text-xl font-semibold tracking-tight text-terminal-text sm:text-2xl">
                Control plane
              </div>
            </div>
            <Button variant="ghost" onClick={toggleTheme}>
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Chip
              label={
                config
                  ? bootstrapError
                    ? "Saved, host unreachable"
                    : bootstrapLoading
                      ? "Syncing"
                      : "Connected"
                  : "Not paired"
              }
              tone={config ? (bootstrapError ? "warn" : bootstrapLoading ? "accent" : "good") : "warn"}
            />
            {bootstrap?.version ? <Chip label={`v${bootstrap.version}`} tone="neutral" /> : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-1">
            <AppNavButton
              label="Connect"
              active={activeRoute.screen === "connect"}
              onClick={() => navigate("/app/connect")}
              hint="Pair"
            />
            <AppNavButton
              label="Sessions"
              active={activeRoute.screen === "sessions" || activeRoute.screen === "session"}
              onClick={() => navigate("/app/sessions")}
              hint="Live"
            />
            <AppNavButton
              label="Repos"
              active={activeRoute.screen === "repos"}
              onClick={() => navigate("/app/repos")}
              hint="Git"
            />
            <AppNavButton
              label="Settings"
              active={activeRoute.screen === "settings"}
              onClick={() => navigate("/app/settings")}
              hint="Host"
            />
          </div>

          <details className="mt-4 rounded-[24px] border border-terminal-border bg-terminal-code/80 px-4 py-3 xl:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terminal-muted">
                  Current host
                </div>
                <div className="mt-1 text-sm font-semibold text-terminal-text">
                  {currentProjectLabel(bootstrap?.currentProject)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {bootstrap?.github.connected ? (
                  <Chip label={`@${bootstrap.github.user?.login ?? "github"}`} tone="good" />
                ) : (
                  <Chip label="GitHub off" tone="warn" />
                )}
                {bootstrap?.execution.container.available ? <Chip label="Container" tone="accent" /> : null}
              </div>
            </summary>
            <div className="mt-4 space-y-3 text-sm text-terminal-text">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Directory</div>
                <div className="mt-1 break-all text-xs text-terminal-muted">{config?.directory || "Not pinned"}</div>
              </div>
            </div>
          </details>

          <div className="mt-6 hidden space-y-4 rounded-[24px] border border-terminal-border bg-terminal-code px-4 py-4 xl:block">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terminal-muted">
              Current host
            </div>
            <div className="space-y-3 text-sm text-terminal-text">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Project</div>
                <div className="mt-1 font-semibold">{currentProjectLabel(bootstrap?.currentProject)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Directory</div>
                <div className="mt-1 break-all text-xs text-terminal-muted">{config?.directory || "Not pinned"}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {bootstrap?.github.connected ? (
                  <Chip label={`@${bootstrap.github.user?.login ?? "github"}`} tone="good" />
                ) : (
                  <Chip label="GitHub off" tone="warn" />
                )}
                {bootstrap?.execution.container.available ? <Chip label="Container ready" tone="accent" /> : null}
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0 rounded-[28px] border border-terminal-border bg-terminal-panel/70 p-3 shadow-strong backdrop-blur sm:p-4 xl:p-6">
          <header className="mb-4 flex flex-col gap-3 border-b border-terminal-border/80 pb-3 sm:mb-5 xl:mb-6 xl:flex-row xl:items-center xl:justify-between xl:pb-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-terminal-accent">
                {activeLabel}
              </div>
              <h1 className="mt-1 text-panel-title text-terminal-text">Use Nikcli from the web</h1>
            </div>
            {bootstrapError && activeRoute.screen !== "connect" ? <Banner>{bootstrapError}</Banner> : null}
          </header>

          <div className={cn("mx-auto w-full", contentWidthClass)}>
            {activeRoute.screen === "connect" ? <ConnectScreen navigate={navigate} /> : null}
            {activeRoute.screen === "sessions" ? <SessionsScreen navigate={navigate} /> : null}
            {activeRoute.screen === "session" ? (
              <SessionScreen sessionId={activeRoute.sessionId} navigate={navigate} />
            ) : null}
            {activeRoute.screen === "repos" ? <ReposScreen navigate={navigate} /> : null}
            {activeRoute.screen === "settings" ? <SettingsScreen /> : null}
          </div>
        </section>
      </div>
    </main>
  )
}

export default function AppShell(props: { initialPath: string }) {
  return (
    <AppProvider>
      <ClientApp initialPath={props.initialPath} />
    </AppProvider>
  )
}
