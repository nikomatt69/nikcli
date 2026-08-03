import path from "path"
import os from "os"
import fs from "fs/promises"
import z from "zod"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import { Agent } from "../agent/agent"
import { ConfigMarkdown } from "../config/markdown"
import { runPromiseWithLayer, withCurrentInstance, type InstanceContext } from "@/effect"

export namespace PromptParts {
  /**
   * User-message part accepted on prompt input: server-owned fields
   * (messageID/sessionID) are omitted and `id` is optional because it is
   * assigned when the message is persisted.
   */
  export const InputPart = z.discriminatedUnion("type", [
    MessageV2.TextPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "TextPartInput",
      }),
    MessageV2.FilePart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "FilePartInput",
      }),
    MessageV2.AgentPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "AgentPartInput",
      }),
    MessageV2.SubtaskPart.omit({
      messageID: true,
      sessionID: true,
    })
      .partial({
        id: true,
      })
      .meta({
        ref: "SubtaskPartInput",
      }),
  ])
  export type InputPart = z.infer<typeof InputPart>

  function agentGet(name: string) {
    return runPromiseWithLayer(
      Agent.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const agent = yield* Agent.Service
          return yield* agent.get(name)
        }),
      ),
    )
  }

  /**
   * Expands a prompt template into message parts: the template itself becomes
   * the leading text part and every `@name` reference resolves to a file part
   * (relative to the instance worktree, or the home directory for `~/`) or to
   * an agent part when no such file exists. Duplicate references resolve once.
   */
  export async function resolve(ctx: InstanceContext, template: string): Promise<InputPart[]> {
    const parts: InputPart[] = [
      {
        type: "text",
        text: template,
      },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
      files.map(async (match) => {
        const name = match[1]
        if (seen.has(name)) return
        seen.add(name)
        const filepath = name.startsWith("~/")
          ? path.join(os.homedir(), name.slice(2))
          : path.resolve(ctx.worktree, name)

        const stats = await fs.stat(filepath).catch(() => undefined)
        if (!stats) {
          const agent = await agentGet(name)
          if (agent) {
            parts.push({
              type: "agent",
              name: agent.name,
            })
          }
          return
        }

        if (stats.isDirectory()) {
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: "application/x-directory",
          })
          return
        }

        parts.push({
          type: "file",
          url: pathToFileURL(filepath).href,
          filename: name,
          mime: "text/plain",
        })
      }),
    )
    return parts
  }
}
