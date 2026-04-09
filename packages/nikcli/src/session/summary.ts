import { Provider } from "@/provider/provider"
import { fn } from "@/util/fn"
import z from "zod"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { Identifier } from "@/id/id"
import { Snapshot } from "@/snapshot"
import { Log } from "@/util/log"
import path from "path"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { Bus } from "@/bus"
import { LLM } from "./llm"
import { Agent } from "@/agent/agent"

export namespace SessionSummary {
  const log = Log.create({ service: "session.summary" })

  async function messagesForSummary(input: { sessionID: string; messageID: string }) {
    const all = await Session.messages({ sessionID: input.sessionID })
    const anchor = all.find((message) => message.info.id === input.messageID)
    if (!anchor) {
      return {
        all,
        focus: [] as MessageV2.WithParts[],
        rootID: input.messageID,
      }
    }

    const rootID = anchor.info.role === "assistant" ? anchor.info.parentID : anchor.info.id
    return {
      all,
      rootID,
      focus: all.filter(
        (message) =>
          message.info.id === rootID || (message.info.role === "assistant" && message.info.parentID === rootID),
      ),
    }
  }

  export const summarize = fn(
    z.object({
      sessionID: z.string(),
      messageID: z.string(),
    }),
    async (input) => {
      const all = await Session.messages({ sessionID: input.sessionID })
      await Promise.all([
        summarizeSession({ sessionID: input.sessionID, messages: all }),
        summarizeMessage({ messageID: input.messageID, messages: all }),
      ])
    },
  )

  async function summarizeSession(input: { sessionID: string; messages: MessageV2.WithParts[] }) {
    const files = new Set(
      input.messages
        .flatMap((x) => x.parts)
        .filter((x) => x.type === "patch")
        .flatMap((x) => x.files)
        .map((x) => path.relative(Instance.worktree, x)),
    )
    const diffs = await computeDiff({ messages: input.messages }).then((x) =>
      x.filter((x) => {
        return files.has(x.file)
      }),
    )
    await Session.update(input.sessionID, (draft) => {
      draft.summary = {
        additions: diffs.reduce((sum, x) => sum + x.additions, 0),
        deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
        files: diffs.length,
      }
    })
    await Storage.write(["session_diff", input.sessionID], diffs)
    Bus.publish(Session.Event.Diff, {
      sessionID: input.sessionID,
      diff: diffs,
    })
  }

  async function summarizeMessage(input: { messageID: string; messages: MessageV2.WithParts[] }) {
    const anchor = input.messages.find((message) => message.info.id === input.messageID)
    if (!anchor) return
    const rootID = anchor.info.role === "assistant" ? anchor.info.parentID : anchor.info.id
    const messages = input.messages.filter(
      (message) =>
        message.info.id === rootID || (message.info.role === "assistant" && message.info.parentID === rootID),
    )
    const msgWithParts = messages.find((message) => message.info.id === rootID)
    if (!msgWithParts || msgWithParts.info.role !== "user") return
    const userMsg = msgWithParts.info as MessageV2.User
    const diffs = await computeDiff({ messages })
    userMsg.summary = {
      ...userMsg.summary,
      diffs,
    }
    await Session.updateMessage(userMsg)

    const textPart = msgWithParts.parts.find((p) => p.type === "text" && !p.synthetic) as MessageV2.TextPart
    if (textPart && userMsg.summary?.title === undefined) {
      const agent = await Agent.get("title")
      if (!agent) return
      const stream = await LLM.stream({
        agent,
        user: userMsg,
        tools: {},
        model: agent.model
          ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
          : ((await Provider.getSmallModel(userMsg.model.providerID)) ??
            (await Provider.getModel(userMsg.model.providerID, userMsg.model.modelID))),
        small: true,
        messages: [
          {
            role: "user" as const,
            content: `
              The following is the text to summarize:
              <text>
              ${textPart?.text ?? ""}
              </text>
            `,
          },
        ],
        abort: new AbortController().signal,
        sessionID: userMsg.sessionID,
        system: [],
        retries: 3,
      })
      const result = await stream.text.catch((error) => {
        log.error("failed to generate title", { error })
        return undefined
      })
      if (!result?.trim()) return
      log.info("title", { title: result })
      userMsg.summary.title = result
      await Session.updateMessage(userMsg)
    }
  }

  export const diff = fn(
    z.object({
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message").optional(),
    }),
    async (input) => {
      if (!input.messageID) {
        return Storage.read<Snapshot.FileDiff[]>(["session_diff", input.sessionID]).catch(() => [])
      }

      const { focus, rootID } = await messagesForSummary({
        sessionID: input.sessionID,
        messageID: input.messageID,
      })
      const root = focus.find((message) => message.info.id === rootID)
      if (root?.info.role === "user" && root.info.summary?.diffs) {
        return root.info.summary.diffs
      }
      if (!focus.length) return []
      return computeDiff({ messages: focus })
    },
  )

  export async function computeDiff(input: { messages: MessageV2.WithParts[] }) {
    let from: string | undefined
    let to: string | undefined

    for (const item of input.messages) {
      if (!from) {
        for (const part of item.parts) {
          if (part.type === "step-start" && part.snapshot) {
            from = part.snapshot
            break
          }
        }
      }

      for (const part of item.parts) {
        if (part.type === "step-finish" && part.snapshot) {
          to = part.snapshot
          break
        }
      }
    }

    if (from && to) return Snapshot.diffFull(from, to)
    return []
  }
}
