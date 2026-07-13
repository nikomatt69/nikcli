import { useCallback, useEffect, useMemo, useState } from "react"
import {
  formatRelativeTime,
  getErrorMessage,
  type MobileLoop,
  type MobileLoopRun,
  type MobileLoopRuntime,
  type MobileLoopTemplate,
  type MobileRoutine,
  WebNikcliClient,
} from "@/app/api"
import { Banner, Button, Chip, EmptyState, Field, Spinner, Surface, TextAreaField } from "@/app/ui"

function triggerLabel(routine: MobileRoutine) {
  const labels: string[] = []
  for (const trigger of routine.triggers) {
    if (trigger.type === "schedule") labels.push(`cron ${trigger.cron}${trigger.enabled ? "" : " (off)"}`)
    if (trigger.type === "api") labels.push(`api trigger${trigger.enabled ? "" : " (off)"}`)
  }
  return labels.length ? labels : ["manual"]
}

function loopTriggerLabel(loop: MobileLoop) {
  if (loop.trigger.kind === "interval") {
    const minutes = Math.round(loop.trigger.everyMs / 60000)
    return minutes >= 60 ? `every ${Math.round(minutes / 60)}h` : `every ${minutes}m`
  }
  return "manual"
}

function runStatusTone(status: MobileLoopRun["status"]) {
  if (status === "complete") return "good" as const
  if (status === "running") return "accent" as const
  return "warn" as const
}

export function AutomationsScreen(props: { client: WebNikcliClient | null; navigate(path: string): void }) {
  const { client } = props
  const [routines, setRoutines] = useState<MobileRoutine[]>([])
  const [loops, setLoops] = useState<MobileLoop[]>([])
  const [runtimes, setRuntimes] = useState<Record<string, MobileLoopRuntime>>({})
  const [recentRuns, setRecentRuns] = useState<MobileLoopRun[]>([])
  const [templates, setTemplates] = useState<MobileLoopTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const [routineName, setRoutineName] = useState("")
  const [routinePrompt, setRoutinePrompt] = useState("")
  const [routineCron, setRoutineCron] = useState("")
  const [creatingRoutine, setCreatingRoutine] = useState(false)

  const [loopDescription, setLoopDescription] = useState("")
  const [generatingLoop, setGeneratingLoop] = useState(false)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setMessage(null)
      const [routineList, loopList, runsResult, templateResult] = await Promise.all([
        client.listRoutines(),
        client.listLoops(),
        client.listRecentLoopRuns(12).catch(() => ({ runs: [] as MobileLoopRun[] })),
        client.listLoopTemplates().catch(() => ({ templates: [] as MobileLoopTemplate[] })),
      ])
      setRoutines(routineList)
      setLoops(loopList.loops)
      setRuntimes(Object.fromEntries(loopList.runtimes.map((runtime) => [runtime.loopID, runtime])))
      setRecentRuns(runsResult.runs)
      setTemplates(templateResult.templates)
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const withAction = useCallback(
    async (key: string, action: () => Promise<unknown>, successNotice?: string) => {
      try {
        setBusyKey(key)
        setMessage(null)
        setNotice(null)
        await action()
        if (successNotice) setNotice(successNotice)
        await load()
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setBusyKey(null)
      }
    },
    [load],
  )

  const createRoutine = useCallback(async () => {
    if (!client || !routineName.trim() || !routinePrompt.trim()) {
      setMessage("Routine name and prompt are required")
      return
    }
    try {
      setCreatingRoutine(true)
      setMessage(null)
      await client.createRoutine({
        name: routineName.trim(),
        prompt: routinePrompt.trim(),
        triggers: routineCron.trim() ? [{ type: "schedule", cron: routineCron.trim(), enabled: true }] : undefined,
      })
      setRoutineName("")
      setRoutinePrompt("")
      setRoutineCron("")
      setNotice("Routine created")
      await load()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setCreatingRoutine(false)
    }
  }, [client, load, routineCron, routineName, routinePrompt])

  const runRoutine = useCallback(
    async (routine: MobileRoutine) => {
      if (!client) return
      try {
        setBusyKey(`routine-run-${routine.id}`)
        setMessage(null)
        const session = await client.runRoutine(routine.id)
        props.navigate(`/app/sessions/${session.id}`)
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setBusyKey(null)
      }
    },
    [client, props],
  )

  const applyTemplate = useCallback(
    async (template: MobileLoopTemplate) => {
      if (!client) return
      await withAction(
        `template-${template.id}`,
        () =>
          client.createLoop({
            name: template.draft.name ?? template.title,
            stages: template.draft.stages.map((stage, index) => ({
              name: stage.name?.trim() || `Stage ${index + 1}`,
              agent: stage.agent?.trim() || "ralph",
              model: stage.model,
              objective: stage.objective,
              tokenBudget: stage.tokenBudget,
            })),
            trigger: template.draft.intervalMs
              ? { kind: "interval", everyMs: template.draft.intervalMs }
              : { kind: "manual" },
            maxRuns: template.draft.maxRuns,
            enabled: false,
          }),
        `Loop created from "${template.title}" (disabled until you enable it)`,
      )
    },
    [client, withAction],
  )

  const generateLoop = useCallback(async () => {
    if (!client || !loopDescription.trim()) {
      setMessage("Describe the loop you want to generate")
      return
    }
    try {
      setGeneratingLoop(true)
      setMessage(null)
      const draft = await client.generateLoop(loopDescription.trim())
      await client.createLoop({
        name: draft.name,
        stages: draft.stages,
        trigger: draft.trigger,
        maxRuns: draft.maxRuns,
        timeoutMs: draft.timeoutMs,
        createPR: draft.createPR,
        enabled: false,
      })
      setLoopDescription("")
      setNotice(`Loop "${draft.name}" generated (disabled until you enable it)`)
      await load()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setGeneratingLoop(false)
    }
  }, [client, load, loopDescription])

  const runningLoops = useMemo(
    () => Object.values(runtimes).filter((runtime) => runtime.status === "running").length,
    [runtimes],
  )

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Automations"
        title="Routines and autonomous loops"
        description="The same scheduled routines and multi-stage loops available on mobile and in the CLI, managed from the browser: create, run, pause, and audit recent activity."
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Chip label={`${routines.length} routines`} tone="accent" />
          <Chip label={`${loops.length} loops`} tone="accent" />
          <Chip label={`${runningLoops} running`} tone={runningLoops ? "accent" : "neutral"} />
          <Chip label={`${recentRuns.length} recent runs`} tone="neutral" />
        </div>
      </Surface>

      {message ? <Banner>{message}</Banner> : null}
      {notice ? <Banner tone="good">{notice}</Banner> : null}

      {loading ? (
        <Surface title="Loading automations">
          <Spinner label="Fetching routines and loops" />
        </Surface>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
          <div className="space-y-6">
            <Surface
              eyebrow="Routines"
              title="Scheduled prompts"
              description="A routine is a saved prompt that runs on a cron schedule or via API trigger, producing a fresh session each run."
            >
              {routines.length === 0 ? (
                <EmptyState
                  title="No routines yet"
                  description="Create the first routine below: give it a name, the prompt to execute, and an optional cron schedule."
                />
              ) : (
                <div className="space-y-3">
                  {routines.map((routine) => (
                    <div
                      key={routine.id}
                      className="rounded-[24px] border border-terminal-border bg-terminal-panel px-4 py-4 shadow-soft"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="break-words text-base font-semibold text-terminal-text">{routine.name}</div>
                          <div className="line-clamp-2 text-sm text-terminal-muted">{routine.prompt}</div>
                        </div>
                        <Chip
                          label={routine.paused ? "Paused" : "Active"}
                          tone={routine.paused ? "warn" : "good"}
                          caps
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {triggerLabel(routine).map((label) => (
                          <Chip key={label} label={label} tone="neutral" mono />
                        ))}
                        {routine.lastRunAt ? (
                          <Chip label={`Last run ${formatRelativeTime(routine.lastRunAt)}`} tone="neutral" />
                        ) : null}
                        {routine.model ? <Chip label={routine.model.modelID} tone="neutral" mono /> : null}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          busy={busyKey === `routine-run-${routine.id}`}
                          onClick={() => void runRoutine(routine)}
                        >
                          Run now
                        </Button>
                        <Button
                          variant="secondary"
                          busy={busyKey === `routine-toggle-${routine.id}`}
                          onClick={() =>
                            void withAction(`routine-toggle-${routine.id}`, () =>
                              routine.paused ? client!.resumeRoutine(routine.id) : client!.pauseRoutine(routine.id),
                            )
                          }
                        >
                          {routine.paused ? "Resume" : "Pause"}
                        </Button>
                        {routine.lastSessionID ? (
                          <Button
                            variant="ghost"
                            onClick={() => props.navigate(`/app/sessions/${routine.lastSessionID}`)}
                          >
                            Last session
                          </Button>
                        ) : null}
                        <Button
                          variant="danger"
                          busy={busyKey === `routine-delete-${routine.id}`}
                          onClick={() =>
                            void withAction(
                              `routine-delete-${routine.id}`,
                              () => client!.deleteRoutine(routine.id),
                              "Routine deleted",
                            )
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Surface>

            <Surface
              eyebrow="New routine"
              title="Create a routine"
              description="Cron format follows the standard five fields, e.g. `0 9 * * 1-5` for weekday mornings. Leave the schedule empty for a manual routine."
            >
              <div className="space-y-4">
                <Field label="Name" value={routineName} onChange={setRoutineName} placeholder="Nightly triage" />
                <TextAreaField
                  label="Prompt"
                  value={routinePrompt}
                  onChange={setRoutinePrompt}
                  placeholder="Review open issues, summarize new failures, and prepare a fix plan..."
                />
                <Field
                  label="Cron schedule (optional)"
                  value={routineCron}
                  onChange={setRoutineCron}
                  placeholder="0 9 * * 1-5"
                />
                <Button busy={creatingRoutine} onClick={() => void createRoutine()}>
                  Create routine
                </Button>
              </div>
            </Surface>
          </div>

          <div className="space-y-6">
            <Surface
              eyebrow="Loops"
              title="Autonomous loops"
              description="Multi-stage agent pipelines that run manually or on an interval, with optional PR creation at the end of each run."
            >
              {loops.length === 0 ? (
                <EmptyState
                  title="No loops yet"
                  description="Start from a template below or generate a loop from a natural-language description."
                />
              ) : (
                <div className="space-y-3">
                  {loops.map((loop) => {
                    const runtime = runtimes[loop.id]
                    const status = runtime?.status ?? "idle"
                    return (
                      <div
                        key={loop.id}
                        className="rounded-[24px] border border-terminal-border bg-terminal-panel px-4 py-4 shadow-soft"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="break-words text-base font-semibold text-terminal-text">{loop.name}</div>
                            <div className="text-xs text-terminal-muted">
                              {loop.stages.length} stages - {loopTriggerLabel(loop)}
                              {loop.maxRuns ? ` - max ${loop.maxRuns} runs` : ""}
                            </div>
                          </div>
                          <Chip
                            label={status}
                            tone={
                              status === "running"
                                ? "accent"
                                : status === "error"
                                  ? "warn"
                                  : loop.enabled
                                    ? "good"
                                    : "neutral"
                            }
                            caps
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Chip
                            label={loop.enabled ? "Enabled" : "Disabled"}
                            tone={loop.enabled ? "good" : "neutral"}
                          />
                          {loop.paused ? <Chip label="Paused" tone="warn" /> : null}
                          {loop.createPR ? <Chip label="Creates PR" tone="accent" /> : null}
                          {runtime?.runs ? <Chip label={`${runtime.runs} runs`} tone="neutral" /> : null}
                          {runtime?.lastRunAt ? (
                            <Chip label={`Last run ${formatRelativeTime(runtime.lastRunAt)}`} tone="neutral" />
                          ) : null}
                          {runtime?.lastError ? <Chip label="Last run failed" tone="warn" /> : null}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            busy={busyKey === `loop-run-${loop.id}`}
                            disabled={status === "running"}
                            onClick={() =>
                              void withAction(`loop-run-${loop.id}`, () => client!.runLoop(loop.id), "Loop run started")
                            }
                          >
                            Run once
                          </Button>
                          {status === "running" ? (
                            <Button
                              variant="danger"
                              busy={busyKey === `loop-abort-${loop.id}`}
                              onClick={() => void withAction(`loop-abort-${loop.id}`, () => client!.abortLoop(loop.id))}
                            >
                              Abort
                            </Button>
                          ) : null}
                          <Button
                            variant="secondary"
                            busy={busyKey === `loop-toggle-${loop.id}`}
                            onClick={() =>
                              void withAction(`loop-toggle-${loop.id}`, () =>
                                client!.toggleLoop(loop.id, !loop.enabled),
                              )
                            }
                          >
                            {loop.enabled ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="secondary"
                            busy={busyKey === `loop-pause-${loop.id}`}
                            onClick={() =>
                              void withAction(`loop-pause-${loop.id}`, () =>
                                loop.paused ? client!.resumeLoop(loop.id) : client!.pauseLoop(loop.id),
                              )
                            }
                          >
                            {loop.paused ? "Resume" : "Pause"}
                          </Button>
                          {runtime?.sessionID ? (
                            <Button
                              variant="ghost"
                              onClick={() => props.navigate(`/app/sessions/${runtime.sessionID}`)}
                            >
                              Session
                            </Button>
                          ) : null}
                          <Button
                            variant="danger"
                            busy={busyKey === `loop-delete-${loop.id}`}
                            onClick={() =>
                              void withAction(
                                `loop-delete-${loop.id}`,
                                () => client!.deleteLoop(loop.id),
                                "Loop deleted",
                              )
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Surface>

            <Surface
              eyebrow="New loop"
              title="Start from a template or a description"
              description="Templates create the loop disabled so you can review it first. The generator asks the configured agent to draft the stages from your description."
            >
              <div className="space-y-4">
                {templates.length ? (
                  <div className="flex flex-wrap gap-2">
                    {templates.map((template) => (
                      <Button
                        key={template.id}
                        variant="secondary"
                        busy={busyKey === `template-${template.id}`}
                        onClick={() => void applyTemplate(template)}
                      >
                        {template.title}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <TextAreaField
                  label="Generate from description"
                  value={loopDescription}
                  onChange={setLoopDescription}
                  placeholder="Keep flaky tests green: run the suite, fix the first failure, repeat every hour..."
                />
                <Button busy={generatingLoop} onClick={() => void generateLoop()}>
                  Generate loop
                </Button>
              </div>
            </Surface>

            <Surface
              eyebrow="Activity"
              title="Recent loop runs"
              description="Most recent runs across every loop in the current project."
            >
              {recentRuns.length === 0 ? (
                <div className="text-sm text-terminal-muted">No loop runs recorded yet.</div>
              ) : (
                <div className="space-y-2">
                  {recentRuns.map((run) => {
                    const loopName = loops.find((loop) => loop.id === run.loopID)?.name ?? run.loopID
                    return (
                      <div
                        key={run.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-terminal-border bg-terminal-code px-3 py-3"
                      >
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold text-terminal-text">{loopName}</div>
                          <div className="text-xs text-terminal-muted">
                            Started {formatRelativeTime(run.startedAt)}
                            {run.error ? ` - ${run.error}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip label={run.status} tone={runStatusTone(run.status)} caps />
                          {run.pullRequest ? (
                            <a
                              className="text-xs font-semibold text-terminal-accent underline"
                              href={run.pullRequest.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              PR #{run.pullRequest.number}
                            </a>
                          ) : null}
                          {run.sessionID ? (
                            <Button variant="ghost" onClick={() => props.navigate(`/app/sessions/${run.sessionID}`)}>
                              Open
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Surface>
          </div>
        </div>
      )}
    </div>
  )
}
