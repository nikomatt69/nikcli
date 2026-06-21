import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Effect } from "effect"
import { appendFile, mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { Session } from "@/session"
import { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import { MessageRepo } from "@/session/message-repo"
import { Project } from "@/project/project"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { withInstance, withInstanceAsync } from "@/effect"
import { Instance } from "@/project/instance"
import { createWorkspaceArchive, uploadWorkspaceArchive } from "@/util/teleport-archive"
import { errors } from "../../error"
import { log, runProject, runSession, runSessionForSession } from "./helpers"

/**
 * Payload sent by the local TUI/CLI `/teleport`. It carries a full session
 * transcript (info + messages with parts) and, optionally, an `uploadID`
 * referencing a working-directory tarball previously streamed in chunks (see
 * the `/teleport/upload` routes) so the remote can recreate both the
 * conversation and its content for resuming from the mobile app.
 */
export const TeleportInput = z.object({
  title: z.string().optional(),
  name: z.string().optional().describe("Display name for the project/repo created on this server"),
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

/**
 * Input for teleporting a session that lives on THIS server out to another
 * server. Used by the mobile app, which has no filesystem of its own — the
 * server archives the session's working directory and ships it for the client.
 */
export const TeleportOutInput = z.object({
  url: z.string().describe("Target server base URL"),
  token: z.string().describe("Target server mobile Bearer token"),
  content: z.boolean().optional().describe("Clone the working directory too (default true)"),
  includeGit: z.boolean().optional().describe("Include full .git history in the clone"),
})
export type TeleportOutInput = z.infer<typeof TeleportOutInput>

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

/** Normalize a target server URL into a base origin we can append `/mobile/...` to. */
function normalizeBaseUrl(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    return url.origin + url.pathname.replace(/\/+$/, "").replace(/\/mobile(\/teleport)?$/, "")
  } catch {
    return null
  }
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

async function git(args: string[], cwd: string): Promise<boolean> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "nikcli",
      GIT_AUTHOR_EMAIL: "teleport@nikcli",
      GIT_COMMITTER_NAME: "nikcli",
      GIT_COMMITTER_EMAIL: "teleport@nikcli",
    },
  })
  return (await proc.exited) === 0
}

/**
 * Give a teleported workspace a git identity if it doesn't already have one.
 * The archive ships without `.git` by default, so we initialize a repo and make
 * an initial commit — this gives the project a stable id (so it shows up as a
 * distinct repo) and lets diffs/snapshots work on the server.
 */
async function ensureGitRepo(directory: string): Promise<void> {
  if (await git(["rev-parse", "--is-inside-work-tree"], directory)) return
  if (!(await git(["init"], directory))) return
  await git(["add", "-A"], directory)
  await git(["commit", "-m", "Teleported workspace", "--no-verify", "--allow-empty"], directory)
}

/**
 * Register the extracted directory as a project so it appears in the mobile repo
 * list, and give it a friendly display name. Returns the resolved project id.
 */
async function registerProject(directory: string, name?: string): Promise<string | undefined> {
  try {
    const { project } = await runProject(
      Effect.gen(function* () {
        const service = yield* Project.Service
        return yield* service.fromDirectory(directory)
      }),
    )
    if (name && project.id !== "global") {
      await runProject(
        Effect.gen(function* () {
          const service = yield* Project.Service
          yield* service.update({ projectID: project.id, name })
        }),
      ).catch(() => undefined)
    }
    return project.id
  } catch (error) {
    log.warn("teleport project registration failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
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
      validator("json", TeleportInput),
      async (c) => {
        const input = c.req.valid("json")

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

          // Give the workspace a git identity and register it so it shows up as a
          // repo in the mobile project list, with a friendly name.
          await ensureGitRepo(directory)
          await registerProject(directory, input.name)
        }

        const result = await importSession(input, directory)
        log.info("teleported session", { ...result, origin: input.origin })
        return c.json(result)
      },
    )
    .post(
      "/session/:sessionID/teleport",
      describeRoute({
        summary: "Teleport a session from this server to another",
        description:
          "Archive the session's working directory and ship its transcript to a target server, so it can be resumed there. Used by the mobile app (which has no local filesystem).",
        operationId: "mobile.session.teleport.out",
        responses: {
          200: {
            description: "Teleported session",
            content: { "application/json": { schema: resolver(TeleportResult) } },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      validator("json", TeleportOutInput),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const base = normalizeBaseUrl(body.url)
        if (!base) return c.json({ error: "Invalid target server URL" }, 400)
        const token = body.token.trim()
        if (!token) return c.json({ error: "Missing target token" }, 400)

        // Resolve the session and its working directory on this server.
        const info = await runSession(
          Effect.gen(function* () {
            const service = yield* Session.Service
            return yield* service.getAnyProject(sessionID)
          }),
        ).catch(() => undefined)
        if (!info) return c.json({ error: "Session not found" }, 404)

        // Read the full transcript in the session's instance scope.
        const messages = await withInstanceAsync({ directory: info.directory }, async () =>
          runSessionForSession(
            info,
            Effect.gen(function* () {
              const service = yield* Session.Service
              return yield* service.messages({ sessionID })
            }),
          ),
        )

        // Archive + chunk-upload the working directory unless content is disabled.
        let uploadID: string | undefined
        if (body.content !== false) {
          const archive = await createWorkspaceArchive(info.directory, {
            includeGit: Boolean(body.includeGit),
          }).catch((error) => {
            log.warn("teleport-out archive failed", {
              error: error instanceof Error ? error.message : String(error),
            })
            return null
          })
          if (archive) {
            try {
              uploadID = await uploadWorkspaceArchive({ base, token, archivePath: archive.path })
            } catch (error) {
              await archive.cleanup()
              return c.json(
                { error: `Workspace upload failed: ${error instanceof Error ? error.message : String(error)}` },
                400,
              )
            } finally {
              await archive.cleanup()
            }
          }
        }

        const response = await fetch(`${base}/mobile/teleport`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title: info.title,
            name: path.basename(info.directory),
            origin: `server:${info.directory}`,
            permission: info.permission,
            messages,
            uploadID,
          }),
        }).catch((error) => {
          log.error("teleport-out request failed", {
            error: error instanceof Error ? error.message : String(error),
          })
          return undefined
        })

        if (!response) return c.json({ error: `Failed to reach ${base}` }, 400)
        if (!response.ok) {
          const detail = await response.text().catch(() => "")
          return c.json(
            {
              error:
                response.status === 401
                  ? "Unauthorized — check the target token"
                  : `Target server error ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
            },
            400,
          )
        }

        const result = (await response.json().catch(() => null)) as TeleportResult | null
        if (!result) return c.json({ error: "Invalid response from target server" }, 400)
        log.info("teleported session out", { sourceSessionID: sessionID, target: base, ...result })
        return c.json(result)
      },
    )
