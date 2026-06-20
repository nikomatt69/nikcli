import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import { MessageRepo } from "@/session/message-repo"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { withInstance } from "@/effect"
import { Instance } from "@/project/instance"
import { errors } from "../../error"
import { log } from "./helpers"

/**
 * Payload sent by the local TUI/CLI `/teleport`. It carries a full session
 * transcript (info + messages with parts) and, optionally, a tarball of the
 * working directory so the remote server can recreate both the conversation and
 * its content for resuming from the mobile app.
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
  directory: z.string().optional(),
  workspace: z.boolean(),
})
export type TeleportResult = z.infer<typeof TeleportResult>

/** Root under which teleported working directories are materialized on this server. */
function teleportRoot() {
  return path.join(Global.Path.data, "teleport")
}

async function extractArchive(archive: Blob, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  const tmp = path.join(tmpdir(), `nikcli-teleport-${Identifier.ascending("part")}.tar.gz`)
  try {
    await Bun.write(tmp, archive)
    const proc = Bun.spawn(["tar", "-xzf", tmp, "-C", destination], { stdout: "ignore", stderr: "pipe" })
    const code = await proc.exited
    if (code !== 0) {
      const err = await new Response(proc.stderr).text().catch(() => "")
      throw new Error(`tar extract failed (${code})${err ? `: ${err.slice(0, 200)}` : ""}`)
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

/**
 * Persist a teleported transcript into a freshly created session. The caller
 * decides the directory the session lives in (an extracted workspace, or the
 * server's default directory for transcript-only teleports).
 */
async function importSession(input: TeleportInput, directory: string): Promise<TeleportResult> {
  const fallbackTitle = (() => {
    for (const message of input.messages) {
      if (message.info.role !== "user") continue
      const text = message.parts.find((part) => part.type === "text")
      if (text && "text" in text && text.text.trim()) return text.text.trim().slice(0, 100)
    }
    return undefined
  })()

  // Create the session bound to the resolved directory (an extracted workspace,
  // or the server's default directory for transcript-only teleports).
  const session = await withInstance(
    { directory },
    Effect.gen(function* () {
      const service = yield* Session.Service
      return yield* service.create({
        title: input.title ?? fallbackTitle ?? "Teleported session",
        permission: input.permission,
      })
    }).pipe(Effect.provide(Session.defaultLayer)),
  )

  // Rewrite the session reference on every message/part so they attach to the
  // freshly created session, then persist them into the shared message store.
  let messageCount = 0
  for (const message of input.messages) {
    MessageRepo.upsertMessage({ ...message.info, sessionID: session.id } as MessageV2.Info)
    messageCount++
    for (const part of message.parts) {
      MessageRepo.upsertPart({ ...part, sessionID: session.id } as MessageV2.Part)
    }
  }

  // Land the session idle so the mobile app can immediately prompt it.
  await withInstance(
    { directory },
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      yield* status.set(session.id, { type: "idle" })
    }).pipe(Effect.provide(SessionStatus.defaultLayer)),
  ).catch(() => undefined)

  return {
    sessionID: session.id,
    title: session.title,
    messageCount,
    directory: session.directory,
    workspace: directory !== Instance.directory,
  } satisfies TeleportResult
}

export const TeleportRoutes = () =>
  new Hono().post(
    "/teleport",
    describeRoute({
      summary: "Teleport a session to this server",
      description:
        "Recreate a session transcript captured on another machine — optionally cloning its working directory — so it can be continued from the mobile app. Accepts JSON (transcript only) or multipart/form-data with a `payload` field and a `archive` tarball.",
      operationId: "mobile.session.teleport",
      responses: {
        200: {
          description: "Teleported session",
          content: { "application/json": { schema: resolver(TeleportResult) } },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const contentType = c.req.header("content-type") ?? ""

      // Transcript-only path (no working directory): plain JSON body.
      if (!contentType.includes("multipart/form-data")) {
        const parsed = TeleportInput.safeParse(await c.req.json().catch(() => undefined))
        if (!parsed.success) return c.json({ error: "Invalid teleport payload" }, 400)
        const result = await importSession(parsed.data, Instance.directory)
        log.info("teleported session", { ...result, origin: parsed.data.origin })
        return c.json(result)
      }

      // Workspace path: messages JSON + a working-directory tarball.
      const form = await c.req.formData()
      const payloadRaw = form.get("payload")
      if (typeof payloadRaw !== "string") return c.json({ error: "Missing teleport payload" }, 400)
      const parsed = TeleportInput.safeParse(JSON.parse(payloadRaw))
      if (!parsed.success) return c.json({ error: "Invalid teleport payload" }, 400)

      const archive = form.get("archive")
      let directory = Instance.directory
      if (archive instanceof Blob && archive.size > 0) {
        directory = path.join(teleportRoot(), Identifier.ascending("session"))
        try {
          await extractArchive(archive, directory)
        } catch (error) {
          await rm(directory, { recursive: true, force: true }).catch(() => undefined)
          log.error("teleport extract failed", {
            error: error instanceof Error ? error.message : String(error),
          })
          return c.json({ error: "Failed to extract workspace archive" }, 400)
        }
      }

      const result = await importSession(parsed.data, directory)
      log.info("teleported session", { ...result, origin: parsed.data.origin })
      return c.json(result)
    },
  )
