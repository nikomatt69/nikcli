import type { ReactNode } from "react"

/** Tiny classNames joiner — filters falsy values. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}

/* ------------------------------------------------------------------ *
 * Shared class tokens
 *
 * These mirror the "gold standard" pages (Sessions / Profiles / Settings)
 * so every studio page renders identical buttons, inputs, and surfaces.
 * Accent foreground is `text-terminal-bg` (theme-correct: light text on the
 * dark light-mode accent, dark text on the light dark-mode accent).
 * ------------------------------------------------------------------ */

export const cardClass = "rounded-[var(--radius-card)] border border-terminal-border bg-terminal-panel"

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-terminal-accent px-4 py-2.5 text-sm font-semibold text-terminal-bg transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"

export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-terminal-border px-4 py-2.5 text-sm font-medium text-terminal-text transition-colors duration-150 hover:bg-terminal-border/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"

export const btnDanger =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-2.5 text-sm font-semibold text-terminal-error transition-colors duration-150 hover:bg-terminal-error/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"

/** Small pill-sized variants for inline row actions. */
export const btnGhostSm =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-terminal-border px-3 py-1.5 text-xs font-medium text-terminal-text transition-colors duration-150 hover:bg-terminal-border/40 disabled:cursor-not-allowed disabled:opacity-50"

export const btnDangerSm =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-terminal-error/30 px-3 py-1.5 text-xs font-medium text-terminal-error transition-colors duration-150 hover:bg-terminal-error/10 disabled:cursor-not-allowed disabled:opacity-50"

export const btnAccentSm =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-terminal-accent/40 px-3 py-1.5 text-xs font-medium text-terminal-accent transition-colors duration-150 hover:bg-terminal-accent/10 disabled:cursor-not-allowed disabled:opacity-50"

export const inputClass =
  "w-full rounded-[var(--radius-md)] border border-terminal-border bg-terminal-bg px-3.5 py-2.5 text-sm text-terminal-text placeholder:text-terminal-muted/50 outline-none transition-colors duration-150 focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20"

export const selectClass = inputClass

export const labelClass = "block text-xs font-semibold uppercase tracking-[0.16em] text-terminal-muted"

/* ------------------------------------------------------------------ *
 * Components
 * ------------------------------------------------------------------ */

/** Standard page header: accent eyebrow + display title + description, with optional actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-terminal-border/60 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-terminal-accent">{eyebrow}</p>
        <h2 className="mt-2 font-display text-2xl font-bold text-terminal-text sm:text-3xl">{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-terminal-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-col gap-2 sm:flex-row sm:items-center">{actions}</div>}
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(cardClass, "p-6", className)}>{children}</div>
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
      {children}
    </div>
  )
}

export function NoticeBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-terminal-success/30 bg-terminal-success/10 px-4 py-3 text-sm text-terminal-success">
      {children}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent", className)}
      aria-hidden="true"
    />
  )
}

/** Full-width centered loading state used while a page fetches. */
export function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-16" role="status" aria-label="Loading">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

/** Animated skeleton bar for value placeholders. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[var(--radius-sm)] bg-terminal-border/60", className)} aria-hidden="true" />
}

export function StatCard({
  label,
  value,
  detail,
  loading,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  loading?: boolean
}) {
  return (
    <div className={cn(cardClass, "p-5")}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-terminal-muted">{label}</div>
      {loading ? (
        <Skeleton className="mt-2.5 h-8 w-16" />
      ) : (
        <div className="mt-2 text-3xl font-bold tabular-nums text-terminal-text">{value}</div>
      )}
      {detail !== undefined &&
        (loading ? (
          <Skeleton className="mt-2.5 h-3 w-24" />
        ) : (
          <div className="mt-2 text-xs text-terminal-muted">{detail}</div>
        ))}
    </div>
  )
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode
  tone?: "neutral" | "accent" | "success" | "error" | "muted"
}) {
  const tones: Record<string, string> = {
    neutral: "bg-terminal-border/50 text-terminal-muted",
    accent: "bg-terminal-accent/10 text-terminal-accent",
    success: "bg-terminal-success/10 text-terminal-success",
    error: "bg-terminal-error/10 text-terminal-error",
    muted: "bg-terminal-muted/10 text-terminal-muted",
  }
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>
  )
}

/** Empty / not-connected / unavailable state. Icon renders in an accent-tinted tile. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  dashed = true,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  dashed?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-card)] border bg-terminal-panel px-6 py-16 text-center",
        dashed ? "border-dashed border-terminal-border" : "border-terminal-border",
      )}
    >
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)] border border-terminal-accent/20 bg-terminal-accent/10 text-terminal-accent">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-terminal-text">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm leading-6 text-terminal-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Icons (24x24, currentColor) for empty states
 * ------------------------------------------------------------------ */

function emptyIcon(d: string) {
  return (
    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d={d} />
    </svg>
  )
}

export const emptyIcons = {
  lock: emptyIcon("M19 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4"),
  bolt: emptyIcon("M13 2L3 14h9l-1 8 10-12h-9l1-8z"),
  brain: emptyIcon("M12 2a4 4 0 0 0-4 4 4 4 0 0 0-2 7 4 4 0 0 0 4 5 4 4 0 0 0 4-1 4 4 0 0 0 4 1 4 4 0 0 0 4-5 4 4 0 0 0-2-7 4 4 0 0 0-4-4 4 4 0 0 0-4 0z M12 6v12"),
  robot: emptyIcon("M9 15h.01M15 15h.01M12 3v4M5 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"),
  chat: emptyIcon("M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"),
  disk: emptyIcon("M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8"),
}
