import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { appendFile, mkdir, rm } from "fs/promises"
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
 * transcript (info + messages with parts) and, optionally, an `uploadID`
 * referencing a working-directory tarball previously streamed in chunks (see
 * the `/teleport/upload` routes) so the remote can recreate both the
 * conversation and its content for resuming from the mobile app.
 */
export const TeleportInput = z.object({
  title: z.string().optional(),
  origin: z.string().optional().describe("Identifier of the machine the session was teleported from"),
  permission: Session.Info.shape.permission.optional(),
  messages: z.array(MessageV2.WithParts),
  uploadID: z.string().optional().describe("ID of a previously uploaded working-directory archive"),
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

/** In-flight chunked archive uploads, keyed by uploadID → temp tarball path. */
const uploads = new Map<string, { path: string; createdAt: number }>()
const UPLOAD_TTL = 60 * 60 * 1000

function sweepStaleUploads() {
  const now = Date.now()
  for (const [id, entry] of uploads) {
    if (now - entry.createdAt > UPLOAD_TTL) {
      uploads.delete(id)
      void rm(entry.path, { force: true }).catch(() => undefined)
    }
  }
}

/** Root under which teleported working directories are materialized on this server. */
function teleportRoot() {
  return path.join(Global.Path.data, "teleport")
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  const proc = Bun.spawn(["tar", "-xzf", archivePath, "-C", destination], { stdout: "ignore", stderr: "pipe" })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text().catch(() => "")
    throw new Error(`tar extract failed (${code})${err ? `: ${err.slice(0, 200)}` : ""}`)
  }
}

/**
 * Persist a teleported transcript into a freshly created session bound to the
 * given directory (an extracted workspace, or the server's default directory
 * for transcript-only teleports).
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
  new Hono()
    .post(
      "/teleport/upload",
      describeRoute({
        summary: "Begin a teleport workspace upload",
        description: "Allocate a chunked upload slot for a working-directory tarball. Returns an uploadID.",
        operationId: "mobile.session.teleport.upload.begin",
        responses: {
          200: {
            description: "Upload slot",
            content: { "application/json": { schema: resolver(z.object({ uploadID: z.string() })) } },
          },
        },
      }),
      async (c) => {
        sweepStaleUploads()
        const uploadID = Identifier.ascending("session")
        const tmp = path.join(tmpdir(), `nikcli-teleport-${uploadID}.tar.gz`)
        await Bun.write(tmp, new Uint8Array(0))
        uploads.set(uploadID, { path: tmp, createdAt: Date.now() })
        return c.json({ uploadID })
      },
    )
    .post(
      "/teleport/upload/:uploadID",
      describeRoute({
        summary: "Append a teleport upload chunk",
        description: "Append raw bytes to a chunked working-directory upload.",
        operationId: "mobile.session.teleport.upload.chunk",
        responses: {
          200: {
            description: "Chunk stored",
            content: { "application/json": { schema: resolver(z.object({ ok: z.literal(true) })) } },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const entry = uploads.get(c.req.param("uploadID"))
        if (!entry) return c.json({ error: "Unknown upload" }, 404)
        const chunk = new Uint8Array(await c.req.arrayBuffer())
        await appendFile(entry.path, chunk)
        return c.json({ ok: true as const })
      },
    )
    .post(
      "/teleport",
      describeRoute({
        summary: "Teleport a session to this server",
        description:
          "Recreate a session transcript captured on another machine — optionally cloning its working directory via a previously uploaded `uploadID` — so it can be continued from the mobile app.",
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
        const parsed = TeleportInput.safeParse(await c.req.json().catch(() => undefined))
        if (!parsed.success) return c.json({ error: "Invalid teleport payload" }, 400)
        const input = parsed.data

        let directory = Instance.directory
        const upload = input.uploadID ? uploads.get(input.uploadID) : undefined
        if (input.uploadID && !upload) return c.json({ error: "Workspace upload not found or expired" }, 400)

        if (upload) {
          directory = path.join(teleportRoot(), Identifier.ascending("session"))
          try {
            await extractArchive(upload.path, directory)
          } catch (error) {
            await rm(directory, { recursive: true, force: true }).catch(() => undefined)
            log.error("teleport extract failed", {
              error: error instanceof Error ? error.message : String(error),
            })
            return c.json({ error: "Failed to extract workspace archive" }, 400)
          } finally {
            uploads.delete(input.uploadID!)
            await rm(upload.path, { force: true }).catch(() => undefined)
          }
        }

        const result = await importSession(input, directory)
        log.info("teleported session", { ...result, origin: input.origin })
        return c.json(result)
      },
    )
