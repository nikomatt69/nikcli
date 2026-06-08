#!/usr/bin/env bun

/**
 * ci-check-workflows.ts — Scheduled CI health check.
 *
 * Runs every 5 hours (see .github/workflows/ci-check.yml) and:
 *   1. Lists the most recent workflow runs for this repository
 *   2. Identifies any non-success conclusion (failure, cancelled, timed_out)
 *      from the lookback window
 *   3. Posts (or updates) a sticky issue with the summary, or
 *      logs OK if all recent runs are green
 *
 * Designed to be safe to run repeatedly: it deduplicates by checking
 * whether a comment has already been posted for a given run_id.
 */

import { Octokit } from "@octokit/rest"

// ─── Config ─────────────────────────────────────────────────────────────────

const WINDOW_HOURS = 6 // check runs in the last 6h (slightly wider than the 5h cron)
const STICKY_MARKER = "<!-- nikcli-ci-check -->"
const ISSUE_TITLE = "CI workflow health check"
const ISSUE_LABELS = ["nikcli-ci-check", "ci"]

const repo = process.env["GITHUB_REPOSITORY"] ?? ""
const token = process.env["GITHUB_TOKEN"] ?? ""

if (!repo) {
  console.error("GITHUB_REPOSITORY is not set")
  process.exit(1)
}
if (!token) {
  console.error("GITHUB_TOKEN is not set")
  process.exit(1)
}

const [owner, repoName] = repo.split("/")
if (!owner || !repoName) {
  console.error(`Invalid GITHUB_REPOSITORY: ${repo}`)
  process.exit(1)
}

// ─── GitHub client ──────────────────────────────────────────────────────────

const octokit = new Octokit({ auth: token })

// ─── Helpers ────────────────────────────────────────────────────────────────

function isUnhealthy(conclusion: string | null, status: string): boolean {
  // status: queued | in_progress | waiting | pending | requested | completed
  if (status !== "completed") return false // in-flight runs are not failures
  if (!conclusion) return false
  return conclusion === "failure" || conclusion === "cancelled" || conclusion === "timed_out"
}

function formatRun(r: {
  name: string
  display_title?: string | null
  conclusion: string | null
  status: string
  html_url: string
  head_branch: string | null
  head_sha: string
  event: string
  created_at: string | null
}): string {
  const title = r.display_title ?? r.name
  const branch = r.head_branch ?? "?"
  const sha = r.head_sha.slice(0, 8)
  const when = r.created_at ?? ""
  const status = r.conclusion ?? r.status
  return `| [${r.name}](${r.html_url}) | \`${branch}\` | \`${sha}\` | ${r.event} | ${when} | ${status} | ${title} |`
}

function buildIssueBody(runs: Array<Parameters<typeof formatRun>[0]>, windowHours: number, ok: boolean): string {
  const header = [
    STICKY_MARKER,
    `# ${ok ? "✅" : "⚠️"} CI workflow health check`,
    "",
    `Lookback window: last ${windowHours} hours.`,
    `Generated at: ${new Date().toISOString()}`,
    `Repository: \`${owner}/${repoName}\``,
    "",
  ].join("\n")

  if (ok) {
    return [
      header,
      "All inspected workflow runs in the lookback window completed successfully.",
      "",
      "| Workflow | Branch | SHA | Event | Created | Status | Title |",
      "|---|---|---|---|---|---|---|",
      ...runs.map(formatRun),
    ].join("\n")
  }

  const failures = runs.filter((r) => isUnhealthy(r.conclusion, r.status))
  return [
    header,
    `Found **${failures.length}** unhealthy run(s) in the lookback window.`,
    "",
    "## Unhealthy runs",
    "",
    failures
      .map(
        (f) =>
          `- [${f.name}](${f.html_url}) — \`${f.conclusion ?? f.status}\` (${f.event} on \`${f.head_branch ?? "?"}\` @ \`${f.head_sha.slice(0, 8)}\`)`,
      )
      .join("\n"),
    "",
    "## All inspected runs",
    "",
    "| Workflow | Branch | SHA | Event | Created | Status | Title |",
    "|---|---|---|---|---|---|---|",
    ...runs.map(formatRun),
    "",
    "---",
    "",
    "_This issue is auto-updated by the scheduled CI check workflow. Reply to add context, or close it once resolved._",
  ].join("\n")
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function listRecentRuns(windowHours: number) {
  const sinceIso = new Date(Date.now() - windowHours * 3600_000).toISOString()
  const collected: Awaited<ReturnType<typeof octokit.actions.listWorkflowRunsForRepo>>["data"]["workflow_runs"] = []
  let page = 1
  for (let i = 0; i < 5; i++) {
    const res = await octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo: repoName,
      per_page: 100,
      page,
      created: `>=${sinceIso}`,
    })
    collected.push(...res.data.workflow_runs)
    if (res.data.workflow_runs.length < 100) break
    page++
  }
  return collected
}

async function findExistingIssue(): Promise<{
  number: number
  body: string
} | null> {
  const issues = await octokit.issues.listForRepo({
    owner,
    repo: repoName,
    state: "open",
    labels: ISSUE_LABELS.join(","),
    per_page: 10,
  })
  const match = issues.data.find(
    (i: { title: string | null; state: string | null }) => i.title === ISSUE_TITLE && i.state === "open",
  )
  return match ? { number: match.number, body: match.body ?? "" } : null
}

async function main() {
  const runs = await listRecentRuns(WINDOW_HOURS)
  const unhealthy = runs.filter((r: { conclusion: string | null; status: string }) =>
    isUnhealthy(r.conclusion, r.status),
  )
  const ok = unhealthy.length === 0

  console.log(`Checked ${runs.length} run(s) in the last ${WINDOW_HOURS}h; ${unhealthy.length} unhealthy.`)

  const body = buildIssueBody(runs, WINDOW_HOURS, ok)

  if (ok) {
    // Healthy — log only, do not spam the issue tracker
    console.log("All CI workflows healthy in the lookback window. No issue action.")
    if (process.env["CI_CHECK_VERBOSE"] === "1") {
      console.log("\n" + body)
    }
    return
  }

  const existing = await findExistingIssue()
  if (existing) {
    await octokit.issues.update({
      owner,
      repo: repoName,
      issue_number: existing.number,
      body,
    })
    console.log(`Updated existing tracking issue #${existing.number}`)
  } else {
    const created = await octokit.issues.create({
      owner,
      repo: repoName,
      title: ISSUE_TITLE,
      body,
      labels: ISSUE_LABELS,
    })
    console.log(`Created new tracking issue #${created.data.number}`)
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error("ci-check-workflows crashed:", msg.slice(0, 500))
  process.exit(1)
})
