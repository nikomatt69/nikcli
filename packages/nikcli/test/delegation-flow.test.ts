import { preserveTestEnv } from "./helpers/env"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Tool } from "../src/tool/tool"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-delegation-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [{ Instance }, { Delegation }, { BackgroundRun }, { BackgroundRunRepo }, { DelegationTool }, { DelegatorTool }] =
  await Promise.all([
    import("../src/project/instance"),
    import("../src/delegation/manager"),
    import("../src/background/run"),
    import("../src/background/repo"),
    import("../src/tool/delegation"),
    import("../src/tool/delegator"),
  ])

const projectDirs: string[] = []

async function withProject<T>(fn: (projectDir: string) => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-delegation-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn: () => fn(projectDir),
  })
}

function createContext(sessionID: string): Tool.Context {
  return {
    sessionID,
    messageID: "msg_test",
    callID: "call_test",
    agent: "build",
    abort: new AbortController().signal,
    metadata() {},
    async progress() {},
    async ask() {},
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqueSessionID(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  const { Database } = await import("../src/database/database")
  Database.closeAll()
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

// Higher timeout: this flow exercises real storage + polling for finalize/cancel and
// can take well over the default 5s when other test files contend for the same Bun
// worker pool. Keeping it generous prevents flake without masking actual hangs.
const FLOW_TIMEOUT_MS = 30_000

describe("delegation flow", () => {
  it(
    "supports delegation list, count, read, cancel, and session scoping",
    async () => {
      await withProject(async () => {
        const parentSessionID = uniqueSessionID("ses_parent_a")
        const otherSessionID = uniqueSessionID("ses_parent_b")
        const tool = await DelegationTool.init()
        const running = await Delegation.create({
          parentSessionID,
          agent: "explore",
          prompt: "Inspect delegation state",
          source: "task",
        })
        const completed = await Delegation.create({
          parentSessionID,
          agent: "advisor:MiniMax-M2.5",
          prompt: "Give guidance",
          source: "advisor",
        })
        // Use BackgroundRun directly so no timers/heartbeats are registered in Delegation
        const foreign = await BackgroundRun.create({
          parentSessionID: otherSessionID,
          agent: "explore",
          prompt: "Foreign delegation",
          source: "task",
        })

        await Delegation.finalize(completed.id, "complete", "Advisor recommendation")

        const ctx = createContext(parentSessionID)
        let countOutput = ""
        for (let i = 0; i < 20; i++) {
          const count = await tool.executeAsync({ action: "count" }, ctx)
          countOutput = count.output
          if (countOutput.includes("1 delegation(s)")) break
          await sleep(50)
        }
        expect(countOutput).toContain("1 delegation(s)")

        const list = await tool.executeAsync({ action: "list" }, ctx)
        expect(list.output).toContain(running.id)
        expect(list.output).toContain(completed.id)
        expect(list.output).not.toContain(foreign.id)

        const denied = await tool.executeAsync({ action: "list", parentSessionId: otherSessionID }, ctx)
        expect(denied.title).toBe("Delegation access denied")

        const read = await tool.executeAsync({ action: "read", delegationId: completed.id }, ctx)
        expect(read.output).toContain("Advisor recommendation")
        expect(read.output).toContain("**Status:** complete")

        const notFound = await tool.executeAsync({ action: "read", delegationId: foreign.id }, ctx)
        expect(notFound.title).toBe("Delegation not found")

        const cancelled = await tool.executeAsync({ action: "cancel", delegationId: running.id }, ctx)
        expect(cancelled.output).toBe(`Cancelled delegation ${running.id}.`)

        // Poll until cancellation finalizes (scheduleForcedFinalize fires after 1000ms)
        let cancelledStatus: string = ""
        for (let i = 0; i < 20; i++) {
          await sleep(100)
          const inspected = await Delegation.inspect(running.id)
          cancelledStatus = inspected?.status ?? ""
          if (cancelledStatus === "cancelled") break
        }
        expect(cancelledStatus).toBe("cancelled")

        const cancelledRead = await tool.executeAsync({ action: "read", delegationId: running.id }, ctx)
        expect(cancelledRead.output).toContain("**Status:** cancelled")
        expect(cancelledRead.output).toContain("**Error:** Cancelled")
      })
    },
    FLOW_TIMEOUT_MS,
  )

  it("reports delegator status, progress, summary, and access checks", async () => {
    await withProject(async () => {
      const parentSessionID = uniqueSessionID("ses_parent_c")
      const tool = await DelegatorTool.init()
      const delegation = await Delegation.create({
        parentSessionID,
        agent: "explore",
        prompt: "Trace background lifecycle",
        source: "task",
      })

      await Delegation.updateProgress(delegation.id, "Tool grep: completed (delegation lifecycle)")

      const ctx = createContext(parentSessionID)
      const status = await tool.executeAsync({ action: "status", delegationId: delegation.id }, ctx)
      expect(status.output).toContain("**Status:** running")
      expect(status.output).toContain("Tool grep: completed (delegation lifecycle)")

      const progress = await tool.executeAsync({ action: "progress", delegationId: delegation.id }, ctx)
      expect(progress.output).toContain("Tool grep: completed (delegation lifecycle)")

      const runningSummary = await tool.executeAsync({ action: "summarize", delegationId: delegation.id }, ctx)
      expect(runningSummary.output).toContain("Tool grep: completed (delegation lifecycle)")

      await Delegation.finalize(delegation.id, "complete", "Final synthesized result for parent session")

      const doneStatus = await tool.executeAsync({ action: "status", delegationId: delegation.id }, ctx)
      expect(doneStatus.output).toContain("**Status:** complete")

      const summary = await tool.executeAsync({ action: "summarize", delegationId: delegation.id }, ctx)
      expect(summary.output).toContain("Final synthesized result for parent session")
      expect(summary.output).toContain('Use `delegation(action="read", delegationId="')

      const outsider = await tool.executeAsync(
        { action: "status", delegationId: delegation.id },
        createContext("ses_other"),
      )
      expect(outsider.title).toBe("Delegator (not found)")
    })
  })

  it("surfaces research metadata in delegator summaries and artifacts", async () => {
    await withProject(async () => {
      const parentSessionID = uniqueSessionID("ses_parent_research")
      const tool = await DelegatorTool.init()
      const delegation = await Delegation.create({
        parentSessionID,
        agent: "researcher",
        prompt: "Question: How should nikcli integrate autoresearch?",
        source: "research",
        metadata: {
          kind: "research",
          question: "How should nikcli integrate autoresearch?",
        },
      })

      await Delegation.finalize(
        delegation.id,
        "complete",
        [
          "Question: How should nikcli integrate autoresearch?",
          "Confidence: high",
          "",
          "Findings:",
          "- Reuse task + delegation infrastructure (https://example.com/infra)",
          "- Keep the agent read-only (https://example.com/guardrails)",
          "",
          "Sources:",
          "- https://example.com/infra",
          "- https://example.com/guardrails",
        ].join("\n"),
      )

      const ctx = createContext(parentSessionID)
      const status = await tool.executeAsync({ action: "status", delegationId: delegation.id }, ctx)
      expect(status.output).toContain("**Progress:** Question: How should nikcli integrate autoresearch?")

      const summary = await tool.executeAsync({ action: "summarize", delegationId: delegation.id }, ctx)
      expect(summary.output).toContain("**Research Summary:**")
      expect(summary.output).toContain("**Confidence:** high")
      expect(summary.output).toContain("**Sources:** 2")

      const artifact = await BackgroundRun.readArtifact(delegation.id)
      expect(artifact).toContain("**Question:** How should nikcli integrate autoresearch?")
      expect(artifact).toContain("**Confidence:** high")
      expect(artifact).toContain("**Source Count:** 2")
    })
  })

  it("marks stale background runs orphaned during reconciliation", async () => {
    await withProject(async () => {
      const record = await BackgroundRun.create({
        parentSessionID: uniqueSessionID("ses_parent_d"),
        agent: "explore",
        prompt: "Long running exploration",
        source: "task",
      })

      BackgroundRunRepo.update(Instance.project.id, record.id, (draft) => {
        draft.ownerID = "stale-owner"
        draft.heartbeatAt = Date.now() - BackgroundRun.LEASE_TIMEOUT_MS - 1_000
        draft.updatedAt = Date.now() - BackgroundRun.LEASE_TIMEOUT_MS - 1_000
      })

      await BackgroundRun.reconcileInterrupted()

      const reconciled = await BackgroundRun.get(record.id)
      expect(reconciled.status).toBe("orphaned")
      expect(reconciled.error).toBe("Nikcli restarted before the background task completed.")

      const artifact = await BackgroundRun.readArtifact(record.id)
      expect(artifact).toContain("**Status:** orphaned")
      expect(artifact).toContain("Nikcli restarted before the background task completed.")
    })
  })

  it("persists parent agent and accepts older background records without it", async () => {
    await withProject(async () => {
      const parentSessionID = uniqueSessionID("ses_parent_agent")
      const withParent = await BackgroundRun.create({
        parentSessionID,
        agent: "explore",
        parentAgent: "plan",
        prompt: "Inspect wake mode",
        source: "task",
      })
      const withoutParent = await BackgroundRun.create({
        parentSessionID,
        agent: "explore",
        prompt: "Legacy delegation",
        source: "task",
      })

      expect((await BackgroundRun.get(withParent.id)).parentAgent).toBe("plan")
      expect((await BackgroundRun.get(withoutParent.id)).parentAgent).toBeUndefined()
    })
  })

  it("builds parent wake prompt inputs with the launching agent and parent model", () => {
    const base = {
      jobId: "job_123",
      delegationId: "del_worker",
      delegatorDelegationId: "del_delegator",
      description: "finish research",
      status: "complete",
      summary: "done",
      parentModel: {
        modelID: "gpt-parent",
        providerID: "openai",
      },
    }

    const planWake = Delegation.buildParentWakePromptInput("ses_parent_plan", {
      ...base,
      parentAgent: "plan",
    })
    expect(planWake.agent).toBe("plan")
    expect(planWake.delivery).toBe("queue")
    expect(planWake.model).toEqual(base.parentModel)
    expect(planWake.parts[0]?.type).toBe("text")
    if (planWake.parts[0]?.type !== "text") throw new Error("Expected text wake prompt part")
    expect(planWake.parts[0].text).toContain('Background task "finish research" finished.')

    const buildWake = Delegation.buildParentWakePromptInput("ses_parent_build", {
      ...base,
      parentAgent: "build",
    })
    expect(buildWake.agent).toBe("build")

    const legacyWake = Delegation.buildParentWakePromptInput("ses_parent_legacy", base)
    expect(legacyWake.agent).toBeUndefined()
  })
})
