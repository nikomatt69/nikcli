#!/usr/bin/env bun

/**
 * ci-report-failure.ts — Posts a concise failure comment on PRs or tracking issues.
 *
 * Uses @octokit/rest with GITHUB_TOKEN to:
 *   - PR events: create/update a sticky comment with a marker
 *   - Push to live-main: find associated PR, or create/update a tracking issue
 *
 * Never prints full logs or environment values.
 */

// ─── Redaction ──────────────────────────────────────────────────────────────

const REDACT_PATTERNS = [
  /ghp_[A-Za-z0-9]{36,}/g,
  /gho_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{22,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /npm_[A-Za-z0-9]{36,}/g,
  /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g,
  /x-access-token:[A-Za-z0-9_-]+@/g,
]

function redact(text: string): string {
  for (const pattern of REDACT_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]")
  }
  return text
}

// ─── Build comment body ─────────────────────────────────────────────────────

const STICKY_MARKER = "<!-- nikcli-ci-autofix -->"

function buildBody(
  mention: string,
  failedStep: string,
  autofixAttempted: string,
  runUrl: string,
  summary: string,
): string {
  const autofixLabel =
    autofixAttempted === "success"
      ? "✅ Autofix succeeded but validation still failed"
      : autofixAttempted === "failure"
        ? "❌ Autofix attempted and failed"
        : "⏭️ Autofix skipped"

  const truncatedSummary = summary.length > 1500 ? summary.slice(0, 1500) + "\n…(truncated)" : summary

  return [
    STICKY_MARKER,
    `## ⚠️ CI Validation Failed`,
    "",
    `**${mention}** — validation failed on this commit.`,
    "",
    `| Detail | Value |`,
    `|--------|-------|`,
    `| Failed step | ${redact(failedStep)} |`,
    `| Autofix status | ${autofixLabel} |`,
    `| Run | [View full logs](${runUrl}) |`,
    "",
    "### Failure Summary",
    "",
    "```",
    redact(truncatedSummary) || "See full logs for details.",
    "```",
    "",
    "Please inspect the full Actions logs for complete output. Do not share this comment publicly — it may contain redacted paths.",
  ].join("\n")
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY || ""
  const runId = process.env.GITHUB_RUN_ID || ""
  const eventName = process.env.GITHUB_EVENT_NAME || ""
  const sha = process.env.GITHUB_SHA || ""
  const headSha = process.env.GITHUB_HEAD_SHA || sha
  const prNumber = process.env.GITHUB_PR_NUMBER
  const mention = process.env.NIKCLI_CI_FAILURE_MENTION || "@nikomatt69"
  const autofixResult = process.env.AUTOFIX_ATTEMPTED || "skipped"

  if (!token) {
    console.error("GITHUB_TOKEN is not set. Cannot post failure report.")
    process.exit(1)
  }

  const [owner, repoName] = repo.split("/")

  // Dynamically import octokit (available in the project's node_modules)
  let Octokit: any
  try {
    const mod = await import("@octokit/rest")
    Octokit = mod.Octokit || mod.default
  } catch {
    // Fallback: use fetch-based GitHub API calls
    console.log("Using fetch-based GitHub API (no @octokit/rest)")
  }

  const githubBase = "https://api.github.com"
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  async function githubFetch(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${githubBase}${path}`, {
      ...opts,
      headers: { ...headers, ...((opts.headers as Record<string, string>) || {}) },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json()
  }

  async function githubPost(path: string, body: object): Promise<any> {
    return fetch(`${githubBase}${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) {
        const errText = await res.text()
        console.error(`GitHub API POST ${res.status}: ${errText.slice(0, 200)}`)
      }
      return res.ok
    })
  }

  // Read validation summary
  let summary = "(no summary available)"
  try {
    const fs = await import("fs")
    if (fs.existsSync("tmp/ci-validation-summary.md")) {
      summary = fs.readFileSync("tmp/ci-validation-summary.md", "utf8")
    }
  } catch {
    // Fall through with default summary
  }

  // Determine failed step from summary
  const failedStepMatch = summary.match(/## ✗ (.+)/)
  const failedStep = failedStepMatch ? failedStepMatch[1] : "Unknown step"

  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`
  const body = buildBody(mention, failedStep, autofixResult, runUrl, summary)

  // ─── PR comment ──────────────────────────────────────────────────────────
  if (prNumber) {
    console.log(`Posting sticky comment on PR #${prNumber}`)

    if (Octokit) {
      const octokit = new Octokit({ auth: token })
      // Find existing sticky comment
      const { data: comments } = await octokit.issues.listComments({
        owner,
        repo: repoName,
        issue_number: parseInt(prNumber, 10),
        per_page: 100,
      })

      const existing = comments.find((c: any) => c.body && c.body.includes(STICKY_MARKER))

      if (existing) {
        await octokit.issues.updateComment({
          owner,
          repo: repoName,
          comment_id: existing.id,
          body,
        })
        console.log(`Updated existing sticky comment ${existing.id}`)
      } else {
        await octokit.issues.createComment({
          owner,
          repo: repoName,
          issue_number: parseInt(prNumber, 10),
          body,
        })
        console.log(`Created new sticky comment on PR #${prNumber}`)
      }
    } else {
      // Fetch-based fallback
      const comments: any[] = await githubFetch(`/repos/${owner}/${repoName}/issues/${prNumber}/comments`)
      const existing = comments.find((c: any) => c.body && c.body.includes(STICKY_MARKER))

      if (existing) {
        await githubPost(`/repos/${owner}/${repoName}/issues/comments/${existing.id}`, { body })
        console.log(`Updated existing sticky comment ${existing.id}`)
      } else {
        await githubPost(`/repos/${owner}/${repoName}/issues/${prNumber}/comments`, { body })
        console.log(`Created new sticky comment on PR #${prNumber}`)
      }
    }
    return
  }

  // ─── Push to live-main: find associated PR or create tracking issue ──────
  console.log("Searching for PR associated with commit...")

  let associated_PR: number | null = null
  try {
    const prs: any[] = await githubFetch(`/repos/${owner}/${repoName}/commits/${headSha}/pulls`)
    if (prs.length > 0) {
      associated_PR = prs[0].number
      console.log(`Found PR #${associated_PR} for commit ${headSha.slice(0, 8)}`)
    }
  } catch {
    console.log("Could not find associated PR for commit")
  }

  if (associated_PR) {
    // Comment on the PR
    console.log(`Posting sticky comment on PR #${associated_PR}`)

    if (Octokit) {
      const octokit = new Octokit({ auth: token })
      const { data: comments } = await octokit.issues.listComments({
        owner,
        repo: repoName,
        issue_number: associated_PR,
        per_page: 100,
      })

      const existing = comments.find((c: any) => c.body && c.body.includes(STICKY_MARKER))

      if (existing) {
        await octokit.issues.updateComment({
          owner,
          repo: repoName,
          comment_id: existing.id,
          body,
        })
      } else {
        await octokit.issues.createComment({
          owner,
          repo: repoName,
          issue_number: associated_PR,
          body,
        })
      }
    } else {
      const comments: any[] = await githubFetch(`/repos/${owner}/${repoName}/issues/${associated_PR}/comments`)
      const existing = comments.find((c: any) => c.body && c.body.includes(STICKY_MARKER))

      if (existing) {
        await githubPost(`/repos/${owner}/${repoName}/issues/comments/${existing.id}`, { body })
      } else {
        await githubPost(`/repos/${owner}/${repoName}/issues/${associated_PR}/comments`, { body })
      }
    }
    return
  }

  // ─── No PR found: create or update tracking issue ─────────────────────────
  const issueTitle = "CI failure on live-main"

  console.log("No associated PR found. Creating/updating tracking issue.")

  const issueBody = [
    body,
    "",
    `**Commit:** ${sha.slice(0, 8)}`,
    `**Branch:** live-main`,
    "",
    "This is an automated tracking issue. It will be updated if the failure persists.",
  ].join("\n")

  // Search for an existing open tracking issue
  const issueSearchUrl = `/repos/${owner}/${repoName}/issues?state=open&labels=nikcli-ci-failure&per_page=5`

  try {
    const existingIssues: any[] = await githubFetch(issueSearchUrl)
    const trackingIssue = existingIssues.find((i: any) => i.title === issueTitle && i.state === "open")

    if (trackingIssue) {
      // Update existing issue with a new comment
      await githubPost(`/repos/${owner}/${repoName}/issues/${trackingIssue.number}/comments`, { body: issueBody })
      console.log(`Updated tracking issue #${trackingIssue.number}`)
    } else {
      // Create new tracking issue
      await githubPost(`/repos/${owner}/${repoName}/issues`, {
        title: issueTitle,
        body: issueBody,
        labels: ["nikcli-ci-failure", "bug"],
      })
      console.log("Created new tracking issue")
    }
  } catch (err) {
    console.error("Failed to create/update tracking issue:", String(err).slice(0, 200))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Report runner crashed:", String(err).slice(0, 200))
  process.exit(1)
})
