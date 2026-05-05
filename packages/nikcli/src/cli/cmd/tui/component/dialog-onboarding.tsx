import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { createMemo, createSignal, For, on, onMount, Show, Switch, Match, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderList } from "@tui/component/dialog-provider"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { Spinner } from "@tui/component/spinner"
import { UserDB } from "@/db/users"
import { Global } from "@/global"

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionLabel(props: { title: string }) {
  const { theme } = useTheme()
  return (
    <text fg={theme.accent} attributes={TextAttributes.BOLD}>
      {props.title}
    </text>
  )
}

function BulletRow(props: { text: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} fg={theme.success}>
        {"●"}
      </text>
      <text fg={theme.text} flexShrink={1} wrapMode="word">
        {props.text}
      </text>
    </box>
  )
}

function TwoColRow(props: { width: number; label: string; desc: string; labelFg?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row">
      <box width={props.width} flexShrink={0}>
        <text fg={(props.labelFg as any) ?? theme.primary}>{props.label}</text>
      </box>
      <text fg={theme.textMuted} flexShrink={1} wrapMode="word">
        {props.desc}
      </text>
    </box>
  )
}

// ─── Step breadcrumb ──────────────────────────────────────────────────────────

const STEP_NAMES = ["Welcome", "Create account", "Filesystem", "Connect"]

function WizardBreadcrumb(props: { current: number }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row">
      <For each={STEP_NAMES}>
        {(name, i) => (
          <text
            fg={i() === props.current ? theme.primary : theme.borderSubtle}
            attributes={i() === props.current ? TextAttributes.BOLD : undefined}
          >
            {i() > 0 ? "  ·  " : ""}
            {i() + 1}. {name}
          </text>
        )}
      </For>
    </box>
  )
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

const CAPABILITIES = [
  "Read, write and refactor code across your entire project",
  "Execute shell commands, run tests and manage processes",
  "Review git diffs, stage changes and manage commits",
  "Search the web and fetch live documentation on demand",
  "Work in parallel sessions across multiple workspaces",
  "Run proactive background agents via Brain sessions",
  "Extend capabilities via MCP server integrations",
]

const CONCEPTS = [
  { label: "Sessions", desc: "Persistent AI conversations with full access to your codebase, files and tools." },
  { label: "Providers", desc: "AI services you connect (Anthropic, OpenAI, Google…). At least one required." },
  { label: "Agents", desc: "AI personas with custom system prompts, skills and model configurations." },
  { label: "Brain", desc: "Background AI that reviews sessions and builds project knowledge over time." },
  { label: "MCP", desc: "Model Context Protocol — wire in external tools, databases and APIs." },
  { label: "Commands", desc: "Ctrl+P or / in the prompt — access every feature, setting and navigation action." },
]

function WelcomeContent() {
  const { theme } = useTheme()
  return (
    <box gap={2}>
      <text fg={theme.textMuted} wrapMode="word">
        A terminal-native AI coding assistant. Chat with AI models, run autonomous agents and automate development tasks
        — all without leaving your terminal.
      </text>
      <box gap={1}>
        <SectionLabel title="What you can do" />
        <box gap={0}>
          <For each={CAPABILITIES}>{(item) => <BulletRow text={item} />}</For>
        </box>
      </box>
      <box gap={1}>
        <SectionLabel title="Core concepts" />
        <box gap={1}>
          <For each={CONCEPTS}>{(c) => <TwoColRow width={12} label={c.label} desc={c.desc} />}</For>
        </box>
      </box>
    </box>
  )
}

// ─── Step 2: Account creation ─────────────────────────────────────────────────

const ACCOUNT_FIELDS = [
  { key: "username" as const, title: "Choose a username", placeholder: "At least 2 characters" },
  { key: "email" as const, title: "Your email address", placeholder: "your@email.com" },
  { key: "password" as const, title: "Create a password", placeholder: "At least 8 characters" },
]

function AccountFieldInput(props: { placeholder: string; onSubmit: (val: string) => void }) {
  const { theme } = useTheme()
  let textarea!: TextareaRenderable

  onMount(() => {
    setTimeout(() => {
      if (!textarea.isDestroyed) textarea.focus()
    }, 1)
  })

  return (
    <textarea
      height={3}
      keyBindings={[{ name: "return", action: "submit" }]}
      onSubmit={() => props.onSubmit(textarea.plainText)}
      ref={(r: TextareaRenderable) => {
        textarea = r
      }}
      placeholder={props.placeholder}
      textColor={theme.text}
      focusedTextColor={theme.text}
      cursorColor={theme.primary}
    />
  )
}

function AccountContent(props: {
  onComplete: () => void
  setError: (msg: string | null) => void
  error: string | null
  busy: boolean
  setBusy: (v: boolean) => void
}) {
  const { theme } = useTheme()
  const [fieldIdx, setFieldIdx] = createSignal(0)
  const [values, setValues] = createStore({ username: "", email: "", password: "" })
  const fieldDef = createMemo(() => ACCOUNT_FIELDS[fieldIdx()]!)

  const handleSubmit = async (raw: string) => {
    const val = raw.trim()
    props.setError(null)

    if (fieldDef().key === "username" && val.length < 2) {
      props.setError("Username must be at least 2 characters")
      return
    }
    if (fieldDef().key === "email" && !val.includes("@")) {
      props.setError("Please enter a valid email address")
      return
    }
    if (fieldDef().key === "password" && val.length < 8) {
      props.setError("Password must be at least 8 characters")
      return
    }

    setValues(fieldDef().key, raw)

    if (fieldIdx() < ACCOUNT_FIELDS.length - 1) {
      setFieldIdx((i) => i + 1)
      return
    }

    props.setBusy(true)
    try {
      const user = await UserDB.create({
        username: values.username.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
      })
      const token = UserDB.createSession(user.id, 30)
      await UserDB.saveActiveSession(token)
      props.onComplete()
    } catch (err: unknown) {
      props.setError(err instanceof Error ? err.message : "Account creation failed")
    } finally {
      props.setBusy(false)
    }
  }

  return (
    <box gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted}>
          Field <span style={{ fg: theme.primary }}>{fieldIdx() + 1}</span>
          {" of "}
          <span style={{ fg: theme.primary }}>{ACCOUNT_FIELDS.length}</span>
        </text>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {fieldDef().title}
        </text>
      </box>

      <Show when={props.error}>
        <text fg={theme.error}>{props.error}</text>
      </Show>

      <Show
        when={!props.busy}
        fallback={
          <box height={3} flexDirection="row" alignItems="center" gap={1}>
            <Spinner>Creating your account…</Spinner>
          </box>
        }
      >
        <Switch>
          <Match when={fieldIdx() === 0}>
            <AccountFieldInput placeholder={ACCOUNT_FIELDS[0]!.placeholder} onSubmit={handleSubmit} />
          </Match>
          <Match when={fieldIdx() === 1}>
            <AccountFieldInput placeholder={ACCOUNT_FIELDS[1]!.placeholder} onSubmit={handleSubmit} />
          </Match>
          <Match when={fieldIdx() === 2}>
            <AccountFieldInput placeholder={ACCOUNT_FIELDS[2]!.placeholder} onSubmit={handleSubmit} />
          </Match>
        </Switch>
      </Show>

      <Show when={!props.busy}>
        <text fg={theme.textMuted}>
          enter <span style={{ fg: theme.textMuted }}>submit</span>
        </text>
      </Show>
    </box>
  )
}

// ─── Step 3: Filesystem Footprint ─────────────────────────────────────────────

function shortenPath(absPath: string): string {
  const home = Global.Path.home
  if (absPath.startsWith(home)) return "~" + absPath.slice(home.length)
  return absPath
}

function FsRow(props: {
  indent: number
  path: string
  desc: string
  icon?: string
  iconFg?: string
  sensitive?: boolean
  ephemeral?: boolean
}) {
  const { theme } = useTheme()
  const icon = props.icon ?? (props.sensitive ? "●" : props.ephemeral ? "◦" : "·")
  const iconFg = props.iconFg ?? (props.sensitive ? theme.warning : props.ephemeral ? theme.textMuted : theme.textMuted)
  const pathFg = theme.text
  const indent = "  ".repeat(props.indent)
  return (
    <box flexDirection="row">
      <text flexShrink={0} fg={theme.borderSubtle}>
        {indent}
      </text>
      <text flexShrink={0} fg={iconFg}>
        {icon}{" "}
      </text>
      <text fg={pathFg} attributes={TextAttributes.BOLD}>
        {props.path}
      </text>
      <text flexShrink={0}> </text>
      <text fg={theme.textMuted} flexShrink={1} wrapMode="word">
        {props.desc}
      </text>
    </box>
  )
}

function FsSectionHeader(props: { title: string; subtitle: string }) {
  const { theme } = useTheme()
  return (
    <box gap={0}>
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={theme.textMuted}>{props.subtitle}</text>
    </box>
  )
}

const dataRoot = shortenPath(Global.Path.data)
const configRoot = shortenPath(Global.Path.config)
const cacheRoot = shortenPath(Global.Path.cache)
const stateRoot = shortenPath(Global.Path.state)

function FilesystemContent() {
  const { theme } = useTheme()
  return (
    <box gap={2}>
      <text fg={theme.textMuted} wrapMode="word">
        Nikcli stores all data under standard XDG directories. Nothing hidden outside these locations. All data stays on
        your machine — no telemetry.
      </text>

      {/* ── Data ─────────────────────────────────────────────────── */}
      <box gap={1}>
        <FsSectionHeader title="Application Data" subtitle="Persistent data: sessions, auth, databases" />
        <FsRow indent={0} path={`${dataRoot}/`} desc="Data root directory" />
        <FsRow indent={1} path="bin/" desc="Binary installation (curl method)" />
        <FsRow indent={1} path="log/" desc="Application log files" />
        <FsRow indent={1} path="storage/" desc="Sessions, messages, and content" />
        <FsRow indent={2} path="session/" desc="Session metadata per project" />
        <FsRow indent={2} path="message/" desc="Message history" />
        <FsRow indent={2} path="part/" desc="Tool outputs and responses" />
        <FsRow indent={1} path="plans/" desc="Agent planning documents (.md)" />
        <FsRow indent={1} path="snapshot/" desc="Project snapshots" />
        <FsRow indent={1} path="worktree/" desc="Worktree data" />
        <FsRow indent={1} path="sync/" desc="Synchronization data" />
        <FsRow indent={1} path="auth.json" desc="API keys and credentials" sensitive />
        <FsRow indent={1} path="accounts.db" desc="User account database" sensitive />
        <FsRow indent={1} path="workspaces.db" desc="Workspace database" sensitive />
        <FsRow indent={1} path="connectors-auth.json" desc="Connector auth tokens" sensitive />
      </box>

      {/* ── Config ───────────────────────────────────────────────── */}
      <box gap={1}>
        <FsSectionHeader title="Configuration" subtitle="Settings files — persisted across updates" />
        <FsRow indent={0} path={`${configRoot}/`} desc="Config root directory" />
        <FsRow indent={1} path="nikcli.json" desc="Global config: provider, model, agent defaults" />
        <FsRow indent={1} path="tui.json" desc="TUI config: theme, keybinds, plugins" />
        <FsRow indent={1} path="AGENTS.md" desc="Global AI system instructions" />
        <FsRow indent={1} path="skills/" desc="Installed agent skills" />
      </box>

      {/* ── Cache & State ────────────────────────────────────────── */}
      <box gap={1}>
        <FsSectionHeader title="Cache & Runtime State" subtitle="Temporary data — safe to delete anytime" />
        <FsRow indent={0} path={`${cacheRoot}/`} desc="Cache — cleared on version upgrades" ephemeral />
        <FsRow indent={0} path={`${stateRoot}/`} desc="Runtime state directory" ephemeral />
        <FsRow indent={1} path="locks/" desc="Concurrency locks" />
        <FsRow indent={1} path="prompt-history.jsonl" desc="Prompt history" />
      </box>

      {/* ── Project ──────────────────────────────────────────────── */}
      <box gap={1}>
        <FsSectionHeader
          title="Project Directory (optional)"
          subtitle="Created in your repo when you customize a project"
        />
        <FsRow indent={0} path=".nikcli/" desc="Project config directory" />
        <FsRow indent={1} path="commands/" desc="Custom slash commands (.md)" />
        <FsRow indent={1} path="agents/" desc="Custom AI agents (.md)" />
        <FsRow indent={1} path="plugins/" desc="Local plugins (.ts, .js)" />
        <FsRow indent={1} path="package.json" desc="Plugin dependencies" />
        <FsRow indent={1} path=".gitignore" desc="Version control exclusions" />
        <FsRow indent={0} path="nikcli.json" desc="Per-project settings override" />
      </box>

      {/* ── Legend ───────────────────────────────────────────────── */}
      <box>
        <text fg={theme.textMuted} wrapMode="word">
          <span style={{ fg: theme.warning }}>● sensitive</span>
          {"  "}
          <span style={{ fg: theme.textMuted }}>◦ ephemeral (safe to delete)</span>
          {"  "}
          <span style={{ fg: theme.textMuted }}>· normal</span>
        </text>
      </box>
    </box>
  )
}

// ─── Step 4: Connect provider ─────────────────────────────────────────────────

const PROVIDERS_INFO = [
  { name: "Nikcli Zen", desc: "All top models with a single API key — recommended for new users", recommended: true },
  { name: "Anthropic", desc: "Claude Sonnet, Haiku, Opus — best overall for coding tasks" },
  { name: "OpenAI", desc: "GPT-4o, o3, o1 — versatile and widely supported" },
  { name: "Google", desc: "Gemini 2.0 Flash and Pro — fast and cost-effective" },
  { name: "GitHub Copilot", desc: "Claude + GPT-4o via your existing GitHub account" },
  { name: "Groq", desc: "Ultra-fast inference for Llama, Mixtral and open models" },
  { name: "Mistral", desc: "Mistral Large, Codestral — leading European AI provider" },
  { name: "Ollama", desc: "Run open-source models locally — no API key needed" },
]

function ProviderContent() {
  const { theme } = useTheme()
  return (
    <box gap={2}>
      <text fg={theme.textMuted} wrapMode="word">
        Connect at least one AI provider to start chatting. You can connect multiple providers and switch models at any
        time via Ctrl+P → "Switch model".
      </text>
      <box gap={1}>
        <SectionLabel title="Available providers" />
        <box gap={0}>
          <For each={PROVIDERS_INFO}>
            {(p) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={p.recommended ? theme.success : theme.borderSubtle}>
                  {p.recommended ? "★" : "·"}
                </text>
                <box width={16} flexShrink={0}>
                  <text
                    fg={p.recommended ? theme.primary : theme.text}
                    attributes={p.recommended ? TextAttributes.BOLD : undefined}
                  >
                    {p.name}
                  </text>
                </box>
                <text fg={theme.textMuted} flexShrink={1} wrapMode="word">
                  {p.desc}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
      <text fg={theme.textMuted} wrapMode="word">
        After setup, add more providers anytime via Ctrl+P → "Connect provider".
      </text>
    </box>
  )
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────

const STEP_TITLES = ["Welcome to Nikcli", "Create your account", "Filesystem Footprint", "Connect a provider"]

const STEP_CONTINUE_LABELS = [
  "create account",
  "", // account step handles its own footer
  "view filesystem",
  "choose provider",
]

function OnboardingWizard(props: { onComplete: () => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const contentMaxHeight = createMemo(() => Math.max(8, dimensions().height - 12))

  const [step, setStep] = createSignal(0)
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  onMount(() => dialog.setSize("large"))

  // Enter advances info steps (account step manages its own keyboard via textarea)
  // Escape or Backspace goes back (except on step 0)
  useKeyboard((evt) => {
    if (step() === 1) return // textarea captures Enter

    // Back navigation
    if ((evt.name === "escape" || evt.name === "backspace") && step() > 0) {
      evt.preventDefault()
      setStep((s) => s - 1)
      return
    }

    if (evt.name !== "return") return
    evt.preventDefault()
    evt.stopPropagation()
    handleContinue()
  })

  const handleContinue = () => {
    switch (step()) {
      case 0:
        return setStep(1)
      case 2:
        return setStep(3)
      case 3:
        dialog.replace(() => <DialogProviderList />)
        props.onComplete()
        break
    }
  }

  const handleAccountComplete = () => {
    setError(null)
    setStep(2)
  }

  return (
    <box paddingBottom={1}>
      {/* Header */}
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          {STEP_TITLES[step()]}
        </text>
        <text fg={theme.borderSubtle}>nikcli</text>
      </box>

      {/* Step breadcrumb */}
      <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <WizardBreadcrumb current={step()} />
      </box>

      {/* Top separator */}
      <box paddingLeft={2} paddingRight={2}>
        <text fg={theme.borderSubtle}>{"─".repeat(Math.min(72, dimensions().width - 4))}</text>
      </box>

      {/* Content */}
      <Switch>
        <Match when={step() !== 1}>
          <scrollbox
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            maxHeight={contentMaxHeight()}
            scrollbarOptions={{ visible: false }}
          >
            <Switch>
              <Match when={step() === 0}>
                <WelcomeContent />
              </Match>
              <Match when={step() === 2}>
                <FilesystemContent />
              </Match>
              <Match when={step() === 3}>
                <ProviderContent />
              </Match>
            </Switch>
          </scrollbox>
        </Match>
        <Match when={step() === 1}>
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <AccountContent
              onComplete={handleAccountComplete}
              error={error()}
              setError={setError}
              busy={busy()}
              setBusy={setBusy}
            />
          </box>
        </Match>
      </Switch>

      {/* Bottom separator */}
      <box paddingLeft={2} paddingRight={2}>
        <text fg={theme.borderSubtle}>{"─".repeat(Math.min(72, dimensions().width - 4))}</text>
      </box>

      {/* Footer */}
      <box paddingLeft={2} paddingRight={2} paddingTop={1} flexDirection="row" justifyContent="space-between">
        <Show when={step() !== 1}>
          <text fg={theme.textMuted}>
            {"↵ "}
            <span style={{ fg: theme.text }}>{STEP_CONTINUE_LABELS[step()]}</span>
          </text>
        </Show>
        <Show when={step() === 1}>
          <text fg={theme.textMuted}>enter submit · esc cancel</text>
        </Show>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.borderSubtle }}>step </span>
          {step() + 1}/{STEP_NAMES.length}
        </text>
      </box>
    </box>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const DialogOnboarding = {
  run(dialog: DialogContext): Promise<void> {
    return new Promise<void>((resolve) => {
      dialog.replace(
        () => <OnboardingWizard onComplete={resolve} />,
        () => resolve(),
      )
    })
  },
}
