import { preserveTestEnv } from "../helpers/env"
import { removeTestDir } from "../helpers/fs"
import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { HttpRouter } from "effect/unstable/http"
import { BunFileSystem, BunHttpServer, BunPath } from "@effect/platform-bun"
import { Context, Effect, Fiber, Layer, ManagedRuntime } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-permission-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const { InstanceRef, InstanceScope, withCurrentInstance } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { PermissionNext } = await import("@/permission/next")
const { PermissionHttpApi } = await import("@/server/httpapi/permission")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-httpapi-permission-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

function makeHandler(memoMap: Layer.MemoMap) {
  return HttpRouter.toWebHandler(
    PermissionHttpApi.layer.pipe(
      Layer.provide(Layer.mergeAll(BunHttpServer.layerHttpServices, BunFileSystem.layer, BunPath.layer)),
    ),
    { memoMap },
  )
}

async function waitForPending(handle: (request: Request) => Promise<Response>) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await handle(new Request("http://nikcli.local/permission"))
    expect(response.status).toBe(200)
    const pending = (await response.json()) as Array<{ id: string; permission: string }>
    if (pending.length > 0) return pending
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return [] as Array<{ id: string; permission: string }>
}

describe("Permission HttpApi", () => {
  it("lists and replies to permission requests through the Effect HttpApi handler", async () => {
    const directory = await makeProjectDir()
    await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.promise(async () => {
          const memoMap = Effect.runSync(Layer.makeMemoMap)
          const permissionRuntime = ManagedRuntime.make(PermissionNext.defaultLayer, { memoMap })
          const { handler, dispose } = makeHandler(memoMap)
          const httpContext = Context.make(InstanceRef, {
            directory,
            worktree: directory,
            project: Instance.project,
          }) as Context.Context<any>
          const handle = (request: Request) => handler(request, httpContext)
          const fiber = permissionRuntime.runFork(
            withCurrentInstance(
              Effect.gen(function* () {
                const permission = yield* PermissionNext.Service
                yield* permission.ask({
                  permission: "edit",
                  patterns: ["src/index.ts"],
                  sessionID: "ses_httpapi_permission",
                  metadata: { tool: "edit" },
                  always: ["src/index.ts"],
                  ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
                })
              }),
            ),
          )
          const pending = await waitForPending(handle)
          expect(pending).toHaveLength(1)
          expect(pending[0].permission).toBe("edit")

          const replyResponse = await handle(
            new Request(`http://nikcli.local/permission/${pending[0].id}/reply`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reply: "once" }),
            }),
          )
          expect(replyResponse.status).toBe(200)
          expect(await replyResponse.json()).toBe(true)
          await permissionRuntime.runPromise(Fiber.join(fiber))
          await dispose()
          await permissionRuntime.dispose()
        }),
      ),
    )
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => removeTestDir(dir)))
  await removeTestDir(testHome)
})
