// Autonomous follow-ups: the bot checks in on its own — it pings the requester
// when a long-running job finishes, and warns (tagging them) when a job is
// taking unusually long. This is the "Claude can also check in on its own"
// behaviour from Claude Tag, driven by nikcli's session.idle events.

type PostFn = (channel: string, thread: string, text: string) => Promise<void>

type Tracked = {
  channel: string
  thread: string
  requester?: string
  startedAt: number
  notifiedSlow: boolean
}

export namespace FollowUps {
  const tracked = new Map<string, Tracked>() // keyed by sessionID

  let post: PostFn | null = null
  let enabled = false
  let heartbeat: ReturnType<typeof setInterval> | null = null

  // Ping the requester on completion only if the job ran at least this long
  // (short answers already stream back inline — no need to also ping).
  const DONE_AFTER_MS = Math.max(0, Number(process.env.SLACK_FOLLOWUP_DONE_MS ?? "20000"))
  // Warn that a job is taking a while after this long with no completion.
  const SLOW_AFTER_MS = Math.max(5000, Number(process.env.SLACK_FOLLOWUP_SLOW_MS ?? "120000"))
  const HEARTBEAT_MS = 15_000

  export function configure(opts: { post: PostFn; enabled?: boolean }): void {
    post = opts.post
    enabled = opts.enabled !== false && process.env.SLACK_FOLLOWUPS !== "false"
    if (enabled && !heartbeat) {
      heartbeat = setInterval(tick, HEARTBEAT_MS)
      // Don't keep the process alive solely for the heartbeat.
      if (typeof heartbeat === "object" && "unref" in heartbeat) heartbeat.unref()
    }
  }

  /** Call when a prompt is dispatched, so we can follow up on this session. */
  export function startWork(sessionID: string, channel: string, thread: string, requester?: string): void {
    if (!enabled) return
    tracked.set(sessionID, { channel, thread, requester, startedAt: Date.now(), notifiedSlow: false })
  }

  /** Call on the session.idle event — the agent finished its turn. */
  export function onSessionIdle(sessionID: string): void {
    const t = tracked.get(sessionID)
    if (!t) return
    tracked.delete(sessionID)
    if (!enabled || !post) return

    const elapsed = Date.now() - t.startedAt
    // Only ping for jobs slow enough that the user likely looked away,
    // or that we already warned were taking a while.
    if (elapsed < DONE_AFTER_MS && !t.notifiedSlow) return

    const who = t.requester ? `<@${t.requester}> ` : ""
    void post(t.channel, t.thread, `${who}✅ Done — finished the task you asked for.`)
  }

  function tick(): void {
    if (!enabled || !post) return
    const now = Date.now()
    for (const t of tracked.values()) {
      if (t.notifiedSlow) continue
      if (now - t.startedAt < SLOW_AFTER_MS) continue
      t.notifiedSlow = true
      const who = t.requester ? `<@${t.requester}> ` : ""
      void post(
        t.channel,
        t.thread,
        `${who}⏳ Still working on this — it's taking a little longer than usual. I'll ping you here when it's done.`,
      )
    }
  }

  export function stop(): void {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }
}
