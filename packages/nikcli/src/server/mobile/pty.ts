import { Effect } from "effect"
import { Pty } from "@/pty"
import { runPty } from "./helpers"
import { body, isResponse, json } from "./request"

const match = (path: string) => path.match(/^\/mobile\/pty\/([^/]+)$/)?.[1]

export async function handlePtyRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (path === "/mobile/pty" && request.method === "GET") {
    return json(
      await runPty(
        Effect.gen(function* () {
          return yield* (yield* Pty.Service).list()
        }),
      ),
    )
  }
  if (path === "/mobile/pty" && request.method === "POST") {
    const input = await body(request, Pty.CreateInput)
    if (isResponse(input)) return input
    return json(
      await runPty(
        Effect.gen(function* () {
          return yield* (yield* Pty.Service).create(input)
        }),
      ),
    )
  }
  const encodedID = match(path)
  if (!encodedID) return
  const ptyID = decodeURIComponent(encodedID)
  if (request.method === "GET") {
    const info = await runPty(
      Effect.gen(function* () {
        return yield* (yield* Pty.Service).get(ptyID)
      }),
    )
    if (!info) throw new Pty.NotFoundError({ message: "Session not found" })
    return json(info)
  }
  if (request.method === "PUT") {
    const input = await body(request, Pty.UpdateInput)
    if (isResponse(input)) return input
    return json(
      await runPty(
        Effect.gen(function* () {
          return yield* (yield* Pty.Service).update(ptyID, input)
        }),
      ),
    )
  }
  if (request.method === "DELETE") {
    await runPty(
      Effect.gen(function* () {
        yield* (yield* Pty.Service).remove(ptyID)
      }),
    )
    return json(true)
  }
}
