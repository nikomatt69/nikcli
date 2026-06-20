import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import { MessageRepo } from "@/session/message-repo"
import { withInstanceAsync } from "@/effect"
import { errors } from "../../error"
import { log, runSession, runStatusForSession } from "./helpers"

/**
 * Payload sent by the local TUI `/teleport` command. It carries a full session
 * transcript (info + messages with parts) captured on the local machine so the
 * remote server can recreate it and the mobile app can resume the conversation.
 */
export const TeleportInput = z.object({
  title: z.string().optional(),
  origin: z.string().optional().describe("Identifier of the machine the session was teleported from"),
  permission: Session.Info.shape.permission.optional(),
  messages: z.array(MessageV2.WithParts),
})
export type TeleportInput = z.infer<typeof TeleportInput>

export const TeleportResult = z.object({
  sessionID: z.string(),
  title: z.string().optional(),
  messageCount: z.number(),
})
export type TeleportResult = z.infer<typeof TeleportResult>

export const TeleportRoutes = () =>
  new Hono().post(
    "/teleport",
    describeRoute({
      summary: "Teleport a session to this server",
      description:
        "Recreate a session transcript captured on another machine so it can be continued from the mobile app.",
      operationId: "mobile.session.teleport",
      responses: {
        200: {
          description: "Teleported session",
          content: { "application/json": { schema: resolver(TeleportResult) } },
        },
        ...errors(400),
      },
    }),
    validator("json", TeleportInput),
    async (c) => {
      const body = c.req.valid("json")

      // Derive a title from the payload, or fall back to the first user text part.
      const fallbackTitle = (() => {
        for (const message of body.messages) {
          if (message.info.role !== "user") continue
          const text = message.parts.find((part) => part.type === "text")
          if (text && "text" in text && text.text.trim()) return text.text.trim().slice(0, 100)
        }
        return undefined
      })()

      const session = await runSession(
        Effect.gen(function* () {
          const service = yield* Session.Service
          return yield* service.create({
            title: body.title ?? fallbackTitle ?? "Teleported session",
            permission: body.permission,
          })
        }),
      )

      // Rewrite the session reference on every message/part so they attach to the
      // freshly created session, then persist them into the shared message store.
      // Message and part IDs are globally unique ascending identifiers, so they are
      // safe to carry over verbatim.
      let messageCount = 0
      await withInstanceAsync({ directory: session.directory }, async () => {
        for (const message of body.messages) {
          const info = { ...message.info, sessionID: session.id } as MessageV2.Info
          MessageRepo.upsertMessage(info)
          messageCount++
          for (const part of message.parts) {
            MessageRepo.upsertPart({ ...part, sessionID: session.id } as MessageV2.Part)
          }
        }
      })

      // Land the session in an idle state so the mobile app can immediately prompt it.
      await runStatusForSession(
        session,
        Effect.gen(function* () {
          const status = yield* SessionStatus.Service
          return yield* status.set(session.id, { type: "idle" })
        }),
      ).catch(() => undefined)

      log.info("teleported session", {
        sessionID: session.id,
        messageCount,
        origin: body.origin,
      })

      return c.json({
        sessionID: session.id,
        title: session.title,
        messageCount,
      } satisfies TeleportResult)
    },
  )
