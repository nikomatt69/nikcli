import type { ReactNode } from "react"
import type { MobileSessionDetail, MobileSessionSummary } from "@nikcli-ai/sdk/httpapi"

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ")
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function truncateMiddle(value: string, max = 64) {
  if (value.length <= max) return value
  const slice = Math.max(12, Math.floor((max - 3) / 2))
  return `${value.slice(0, slice)}...${value.slice(-slice)}`
}

export function currentProjectLabel(project?: { name?: string; worktree?: string }) {
  if (!project) return "No active workspace"
  if (project.name) return project.name
  if (!project.worktree) return "No active workspace"
  return project.worktree.split("/").filter(Boolean).pop() || project.worktree
}

export function Spinner(props: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-3 text-sm text-terminal-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
      {props.label ? <span>{props.label}</span> : null}
    </div>
  )
}

export function Banner(props: { tone?: "error" | "good" | "warn"; children: ReactNode }) {
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

export function Chip(props: {
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

export function StatusPill(props: { status?: MobileSessionSummary["status"] | MobileSessionDetail["status"] }) {
  const status = props.status?.type ?? "idle"
  const tone = status === "busy" ? "accent" : status === "retry" ? "warn" : "good"
  return <Chip label={status} tone={tone} caps />
}

export function PathBadge(props: { path: string }) {
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

export function Button(props: {
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

export function Field(props: {
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

export function TextAreaField(props: {
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

export function SelectField(props: {
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

export function Surface(props: {
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

export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-[24px] border border-dashed border-terminal-border bg-terminal-panel/60 px-4 py-6 text-center shadow-soft sm:rounded-[28px] sm:px-6 sm:py-8">
      <h3 className="text-lg font-semibold text-terminal-text">{props.title}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-terminal-muted">{props.description}</p>
      {props.action ? <div className="mt-5 flex justify-center">{props.action}</div> : null}
    </div>
  )
}

export function Modal(props: { open: boolean; title: string; children: ReactNode; onClose(): void }) {
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

export function AppNavButton(props: { label: string; active?: boolean; onClick(): void; hint?: string }) {
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
