import { useCallback, useEffect, useMemo, useState } from "react"
import {
  formatRelativeTime,
  getErrorMessage,
  type MobileGitBranchesResponse,
  type MobileGitCommitsResponse,
  type MobileGitDiffResponse,
  type MobileGitStatusResponse,
  WebNikcliClient,
} from "@/app/api"
import { Banner, Button, Chip, cn, EmptyState, Field, Spinner, Surface } from "@/app/ui"

type GitFile = MobileGitStatusResponse["staged"][number]

function fileLabel(file: GitFile) {
  if (file.status === "renamed") return `${file.oldPath} -> ${file.path}`
  return file.path
}

function fileStats(file: GitFile) {
  if (file.status === "added" || file.status === "modified") {
    return `+${file.additions} / -${file.deletions}`
  }
  return null
}

function statusTone(status: GitFile["status"]) {
  if (status === "added") return "good" as const
  if (status === "deleted") return "warn" as const
  return "accent" as const
}

function DiffHunks(props: { diff: MobileGitDiffResponse[number] }) {
  if (props.diff.isBinary) {
    return <div className="text-xs text-terminal-muted">Binary file - no text diff available.</div>
  }
  return (
    <div className="space-y-3">
      {props.diff.hunks.map((hunk, index) => (
        <pre
          key={index}
          className="overflow-x-auto no-scrollbar rounded-2xl border border-terminal-border/70 bg-terminal-panel px-3 py-3 font-mono text-xs leading-6"
        >
          <div className="text-terminal-muted">
            @@ -{hunk.header.oldStart},{hunk.header.oldLines} +{hunk.header.newStart},{hunk.header.newLines} @@
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <div
              key={lineIndex}
              className={cn(
                "whitespace-pre-wrap break-words",
                line.type === "add" && "text-terminal-success",
                line.type === "remove" && "text-terminal-error",
                line.type === "context" && "text-terminal-text",
              )}
            >
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
              {line.text}
            </div>
          ))}
        </pre>
      ))}
    </div>
  )
}

export function GitScreen(props: { client: WebNikcliClient | null }) {
  const { client } = props
  const [status, setStatus] = useState<MobileGitStatusResponse | null>(null)
  const [branches, setBranches] = useState<MobileGitBranchesResponse>([])
  const [commits, setCommits] = useState<MobileGitCommitsResponse>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState("")
  const [newBranch, setNewBranch] = useState("")
  const [diffs, setDiffs] = useState<Record<string, MobileGitDiffResponse[number]>>({})
  const [diffOpen, setDiffOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setMessage(null)
      const [statusResult, branchResult, commitResult] = await Promise.all([
        client.gitStatus(),
        client.gitBranches().catch(() => []),
        client.gitCommits(15).catch(() => []),
      ])
      setStatus(statusResult)
      setBranches(branchResult)
      setCommits(commitResult)
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
      if (!client) return
      try {
        setBusyKey(key)
        setMessage(null)
        setNotice(null)
        await action()
        if (successNotice) setNotice(successNotice)
        setDiffs({})
        setDiffOpen(null)
        await load()
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setBusyKey(null)
      }
    },
    [client, load],
  )

  const loadDiff = useCallback(
    async (file: string, staged: boolean) => {
      if (!client) return
      const key = `${staged ? "staged" : "unstaged"}:${file}`
      if (diffOpen === key) {
        setDiffOpen(null)
        return
      }
      if (diffs[key]) {
        setDiffOpen(key)
        return
      }
      try {
        setBusyKey(`diff-${key}`)
        const result = await client.gitDiff({ file, staged })
        const entry = result.find((item) => item.file === file) ?? result[0]
        if (entry) {
          setDiffs((current) => ({ ...current, [key]: entry }))
          setDiffOpen(key)
        } else {
          setNotice("No diff content for this file")
        }
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setBusyKey(null)
      }
    },
    [client, diffOpen, diffs],
  )

  const commit = useCallback(async () => {
    if (!client || !commitMessage.trim()) {
      setMessage("Commit message is required")
      return
    }
    await withAction(
      "commit",
      () => client.gitCommit({ message: commitMessage.trim(), stagedOnly: true }),
      "Commit created",
    )
    setCommitMessage("")
  }, [client, commitMessage, withAction])

  const stagedCount = status?.staged.length ?? 0
  const unstagedCount = (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)

  const allUnstagedPaths = useMemo(
    () => [...(status?.unstaged.map((file) => file.path) ?? []), ...(status?.untracked ?? [])],
    [status],
  )

  const renderFileRow = (file: GitFile, staged: boolean) => {
    const key = `${staged ? "staged" : "unstaged"}:${file.path}`
    const stats = fileStats(file)
    return (
      <div key={key} className="rounded-2xl border border-terminal-border bg-terminal-code px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <code className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-terminal-text">
              {fileLabel(file)}
            </code>
            <div className="mt-1 flex flex-wrap gap-2">
              <Chip label={file.status} tone={statusTone(file.status)} caps />
              {stats ? <Chip label={stats} tone="neutral" mono /> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {file.status !== "deleted" ? (
              <Button
                variant="ghost"
                busy={busyKey === `diff-${key}`}
                onClick={() => void loadDiff(file.path, staged)}
              >
                {diffOpen === key ? "Hide diff" : "Diff"}
              </Button>
            ) : null}
            {staged ? (
              <Button
                variant="secondary"
                busy={busyKey === `unstage-${file.path}`}
                onClick={() => void withAction(`unstage-${file.path}`, () => client!.gitUnstage([file.path]))}
              >
                Unstage
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  busy={busyKey === `stage-${file.path}`}
                  onClick={() => void withAction(`stage-${file.path}`, () => client!.gitStage([file.path]))}
                >
                  Stage
                </Button>
                <Button
                  variant="danger"
                  busy={busyKey === `discard-${file.path}`}
                  onClick={() =>
                    void withAction(`discard-${file.path}`, () => client!.gitDiscard([file.path]), "Changes discarded")
                  }
                >
                  Discard
                </Button>
              </>
            )}
          </div>
        </div>
        {diffOpen === key && diffs[key] ? (
          <div className="mt-3">
            <DiffHunks diff={diffs[key]} />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Source control"
        title="Git workspace"
        description="The same git controls exposed on mobile and desktop: stage, commit, push, pull, switch branches, and inspect diffs on the currently selected server workspace."
        actions={
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
            <Button
              className="w-full sm:w-auto"
              variant="secondary"
              busy={busyKey === "pull"}
              onClick={() => void withAction("pull", () => client!.gitPull(), "Pulled latest changes")}
            >
              Pull
            </Button>
            <Button
              className="w-full sm:w-auto"
              busy={busyKey === "push"}
              onClick={() => void withAction("push", () => client!.gitPush(), "Branch pushed")}
            >
              Push
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          {status ? (
            <>
              <Chip label={status.branch} tone="accent" mono />
              <Chip label={`${status.commitsAhead} ahead`} tone={status.commitsAhead ? "accent" : "neutral"} />
              <Chip label={`${status.commitsBehind} behind`} tone={status.commitsBehind ? "warn" : "neutral"} />
              <Chip label={`${stagedCount} staged`} tone={stagedCount ? "good" : "neutral"} />
              <Chip label={`${unstagedCount} pending`} tone={unstagedCount ? "accent" : "neutral"} />
            </>
          ) : (
            <Chip label="Status unavailable" tone="warn" />
          )}
        </div>
        {status?.lastCommit ? (
          <div className="mt-4 rounded-2xl border border-terminal-border bg-terminal-code px-4 py-3 text-sm text-terminal-text">
            <span className="font-mono text-xs text-terminal-muted">{status.lastCommit.sha.slice(0, 7)}</span>{" "}
            {status.lastCommit.message}
            <span className="text-terminal-muted">
              {" "}
              - {status.lastCommit.author}, {formatRelativeTime(status.lastCommit.timestamp)}
            </span>
          </div>
        ) : null}
      </Surface>

      {message ? <Banner>{message}</Banner> : null}
      {notice ? <Banner tone="good">{notice}</Banner> : null}

      {loading && !status ? (
        <Surface title="Loading git status">
          <Spinner label="Reading workspace state" />
        </Surface>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
          <div className="space-y-6">
            <Surface
              eyebrow="Changes"
              title="Working tree"
              description="Stage or discard pending changes, then commit the staged set."
              actions={
                allUnstagedPaths.length ? (
                  <Button
                    variant="secondary"
                    busy={busyKey === "stage-all"}
                    onClick={() => void withAction("stage-all", () => client!.gitStage(allUnstagedPaths))}
                  >
                    Stage all
                  </Button>
                ) : undefined
              }
            >
              {status && (status.unstaged.length || status.untracked.length) ? (
                <div className="space-y-3">
                  {status.unstaged.map((file) => renderFileRow(file, false))}
                  {status.untracked.map((path) =>
                    renderFileRow({ status: "added", path, additions: 0, deletions: 0 }, false),
                  )}
                </div>
              ) : (
                <div className="text-sm text-terminal-muted">No unstaged changes.</div>
              )}
            </Surface>

            <Surface
              eyebrow="Staged"
              title="Ready to commit"
              description="These files are included in the next commit."
            >
              {status?.staged.length ? (
                <div className="space-y-3">{status.staged.map((file) => renderFileRow(file, true))}</div>
              ) : (
                <div className="text-sm text-terminal-muted">Nothing staged yet.</div>
              )}
              <div className="mt-4 space-y-3">
                <Field
                  label="Commit message"
                  value={commitMessage}
                  onChange={setCommitMessage}
                  placeholder="feat: describe the change"
                />
                <Button busy={busyKey === "commit"} disabled={!stagedCount} onClick={() => void commit()}>
                  Commit staged changes
                </Button>
              </div>
            </Surface>
          </div>

          <div className="space-y-6">
            <Surface
              eyebrow="Branches"
              title="Switch or create a branch"
              description="Checkout an existing branch or create a new one from the current HEAD."
            >
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {branches.map((branch) => (
                    <Button
                      key={branch.name}
                      variant={branch.isCurrent ? "primary" : "secondary"}
                      disabled={branch.isCurrent}
                      busy={busyKey === `checkout-${branch.name}`}
                      onClick={() =>
                        void withAction(
                          `checkout-${branch.name}`,
                          () => client!.gitCheckout(branch.name),
                          `Switched to ${branch.name}`,
                        )
                      }
                    >
                      {branch.name}
                    </Button>
                  ))}
                </div>
                <Field
                  label="New branch"
                  value={newBranch}
                  onChange={setNewBranch}
                  placeholder="feature/my-branch"
                  action={
                    <Button
                      variant="secondary"
                      busy={busyKey === "create-branch"}
                      disabled={!newBranch.trim()}
                      onClick={() =>
                        void withAction(
                          "create-branch",
                          () => client!.gitCheckout(newBranch.trim(), true),
                          `Created ${newBranch.trim()}`,
                        ).then(() => setNewBranch(""))
                      }
                    >
                      Create
                    </Button>
                  }
                />
              </div>
            </Surface>

            <Surface eyebrow="History" title="Recent commits" description="The latest commits on the current branch.">
              {commits.length === 0 ? (
                <EmptyState title="No commits" description="The commit history for this workspace is empty." />
              ) : (
                <div className="space-y-2">
                  {commits.map((commit) => (
                    <div
                      key={commit.sha}
                      className="rounded-2xl border border-terminal-border bg-terminal-code px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold text-terminal-text">{commit.message}</div>
                          <div className="mt-1 text-xs text-terminal-muted">
                            <span className="font-mono">{commit.sha.slice(0, 7)}</span> - {commit.author.name},{" "}
                            {formatRelativeTime(commit.timestamp)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Chip label={`${commit.filesCount} files`} tone="neutral" />
                          <Chip label={`+${commit.additions} / -${commit.deletions}`} tone="neutral" mono />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Surface>
          </div>
        </div>
      )}
    </div>
  )
}
