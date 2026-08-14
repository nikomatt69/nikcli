import { appendFile, mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import z from "zod"
import { Effect } from "effect"
import { Global } from "@nikcli-ai/util/global"
import { Identifier } from "@nikcli-ai/util/id"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { MessageRepo } from "@/session/message-repo"
import { SessionEntryProjection } from "@/session/v2/projection"
import { SessionStatus } from "@/session/status"
import { withInstance, withInstanceAsync } from "@/effect"
import { createWorkspaceArchive, uploadWorkspaceArchive } from "@nikcli-ai/util/teleport-archive"
import { log, runProject, runSession, runSessionForSession } from "./helpers"
import { body, isResponse, json } from "./request"

export const TeleportInput = z.object({
  title: z.string().optional(),
  name: z.string().optional(),
  origin: z.string().optional(),
  permission: Session.Info.shape.permission.optional(),
  messages: z.array(MessageV2.WithParts),
  uploadID: z.string().optional(),
})
export const TeleportOutInput = z.object({
  url: z.string(),
  token: z.string(),
  content: z.boolean().optional(),
  includeGit: z.boolean().optional(),
})
export type TeleportResult = {
  sessionID: string
  title?: string
  messageCount: number
  directory?: string
  workspace: boolean
}
const uploads = new Map<string, { path: string; createdAt: number }>()
const uploadTtl = 60 * 60 * 1000

function sweep() {
  const now = Date.now()
  for (const [id, entry] of uploads)
    if (now - entry.createdAt > uploadTtl) {
      uploads.delete(id)
      void rm(entry.path, { force: true }).catch(() => undefined)
    }
}
function baseUrl(raw: string) {
  let value = raw.trim()
  if (!value) return
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    return url.origin + url.pathname.replace(/\/+$/, "").replace(/\/mobile(\/teleport)?$/, "")
  } catch {
    return
  }
}
async function git(args: string[], cwd: string) {
  return (
    (await Bun.spawn(["git", ...args], {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "nikcli",
        GIT_AUTHOR_EMAIL: "teleport@nikcli",
        GIT_COMMITTER_NAME: "nikcli",
        GIT_COMMITTER_EMAIL: "teleport@nikcli",
      },
    }).exited) === 0
  )
}
async function extract(archive: string, destination: string) {
  await mkdir(destination, { recursive: true })
  const proc = Bun.spawn(["tar", "-xzf", archive, "-C", destination], {
    stdout: "ignore",
    stderr: "pipe",
    windowsHide: true,
  })
  const code = await proc.exited
  if (code)
    throw new Error(
      `tar extract failed (${code}): ${(await new Response(proc.stderr).text().catch(() => "")).slice(0, 200)}`,
    )
}
async function ensureRepo(directory: string) {
  if (await git(["rev-parse", "--is-inside-work-tree"], directory)) return
  if (!(await git(["init"], directory))) return
  await git(["commit", "-m", "Teleported workspace", "--no-verify", "--allow-empty"], directory)
  void (async () => {
    await git(["add", "-A"], directory)
    await git(["commit", "-m", "Teleported workspace content", "--no-verify", "--allow-empty"], directory)
  })().catch((error) => log.warn("teleport background commit failed", { directory, error }))
}
async function register(directory: string, name?: string) {
  try {
    const { project } = await runProject(
      Effect.gen(function* () {
        return yield* (yield* Project.Service).fromDirectory(directory)
      }),
    )
    if (name && project.id !== "global")
      await runProject(
        Effect.gen(function* () {
          yield* (yield* Project.Service).update({ projectID: project.id, name })
        }),
      ).catch(() => undefined)
  } catch (error) {
    log.warn("teleport project registration failed", { error })
  }
}
async function importSession(input: z.infer<typeof TeleportInput>, directory: string): Promise<TeleportResult> {
  const fallback = input.messages
    .flatMap((message) => (message.info.role === "user" ? message.parts : []))
    .find((part) => part.type === "text" && part.text.trim())
  const session = await withInstance(
    { directory },
    Effect.gen(function* () {
      return yield* (yield* Session.Service).create({
        title:
          input.title ??
          (fallback?.type === "text" ? fallback.text.trim().slice(0, 100) : undefined) ??
          "Teleported session",
        permission: input.permission,
      })
    }).pipe(Effect.provide(Session.defaultLayer)),
  )
  const imported = input.messages.map((message) => {
    const info = { ...message.info, sessionID: session.id } as MessageV2.Info
    const parts = message.parts.map((part) => ({ ...part, sessionID: session.id }) as MessageV2.Part)
    MessageRepo.upsertMessage(info)
    for (const part of parts) MessageRepo.upsertPart(part)
    return { info, parts }
  })
  SessionEntryProjection.rebuild(session.id, imported)
  await withInstance(
    { directory },
    Effect.gen(function* () {
      yield* (yield* SessionStatus.Service).set(session.id, { type: "idle" })
    }).pipe(Effect.provide(SessionStatus.defaultLayer)),
  ).catch(() => undefined)
  return {
    sessionID: session.id,
    title: session.title,
    messageCount: imported.length,
    directory: session.directory,
    workspace: directory !== Instance.directory,
  }
}

export async function handleTeleportRequest(request: Request): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname
  if (request.method !== "POST") return
  if (pathname === "/mobile/teleport/upload") {
    sweep()
    const uploadID = Identifier.ascending("session")
    const target = path.join(tmpdir(), `nikcli-teleport-${uploadID}.tar.gz`)
    await Bun.write(target, new Uint8Array())
    uploads.set(uploadID, { path: target, createdAt: Date.now() })
    return json({ uploadID })
  }
  const chunk = pathname.match(/^\/mobile\/teleport\/upload\/([^/]+)$/)
  if (chunk) {
    const entry = uploads.get(decodeURIComponent(chunk[1]))
    if (!entry) return json({ error: "Unknown upload" }, 404)
    await appendFile(entry.path, new Uint8Array(await request.arrayBuffer()))
    return json({ ok: true })
  }
  if (pathname === "/mobile/teleport") {
    const input = await body(request, TeleportInput)
    if (isResponse(input)) return input
    let directory = Instance.directory
    const upload = input.uploadID ? uploads.get(input.uploadID) : undefined
    if (input.uploadID && !upload) return json({ error: "Workspace upload not found or expired" }, 400)
    if (upload) {
      directory = path.join(Global.Path.data, "teleport", Identifier.ascending("session"))
      try {
        await extract(upload.path, directory)
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined)
        log.error("teleport extract failed", { error })
        return json({ error: "Failed to extract workspace archive" }, 400)
      } finally {
        uploads.delete(input.uploadID!)
        await rm(upload.path, { force: true }).catch(() => undefined)
      }
      await ensureRepo(directory)
      await register(directory, input.name)
    }
    const result = await importSession(input, directory)
    log.info("teleported session", { ...result, origin: input.origin })
    return json(result)
  }
  const outbound = pathname.match(/^\/mobile\/session\/([^/]+)\/teleport$/)
  if (!outbound) return
  const input = await body(request, TeleportOutInput)
  if (isResponse(input)) return input
  const base = baseUrl(input.url)
  if (!base) return json({ error: "Invalid target server URL" }, 400)
  const token = input.token.trim()
  if (!token) return json({ error: "Missing target token" }, 400)
  const sessionID = decodeURIComponent(outbound[1])
  const info = await runSession(
    Effect.gen(function* () {
      return yield* (yield* Session.Service).getAnyProject(sessionID)
    }),
  ).catch(() => undefined)
  if (!info) return json({ error: "Session not found" }, 404)
  const messages = await withInstanceAsync({ directory: info.directory }, () =>
    runSessionForSession(
      info,
      Effect.gen(function* () {
        return yield* (yield* Session.Service).messages({ sessionID })
      }),
    ),
  )
  let uploadID: string | undefined
  if (input.content !== false) {
    const archive = await createWorkspaceArchive(info.directory, { includeGit: Boolean(input.includeGit) }).catch(
      () => null,
    )
    if (archive)
      try {
        uploadID = await uploadWorkspaceArchive({ base, token, archivePath: archive.path })
      } catch (error) {
        return json(
          { error: `Workspace upload failed: ${error instanceof Error ? error.message : String(error)}` },
          400,
        )
      } finally {
        await archive.cleanup()
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
  }).catch(() => undefined)
  if (!response) return json({ error: `Failed to reach ${base}` }, 400)
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    return json(
      {
        error:
          response.status === 401
            ? "Unauthorized — check the target token"
            : `Target server error ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      },
      400,
    )
  }
  const result = await response.json().catch(() => null)
  return result ? json(result) : json({ error: "Invalid response from target server" }, 400)
}
