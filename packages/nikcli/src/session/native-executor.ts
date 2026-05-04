import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { Log } from "@/util/log"

const log = Log.create({ service: "native-executor" })

export namespace NativeExecutor {
  export interface RunResult {
    stdout: string
    stderr: string
    success: boolean
    durationMs: number
  }

  export type ToolBridge = {
    [toolName: string]: (args: unknown) => Promise<string>
  }

  // The worker bootstrap script receives user code via postMessage instead of
  // string interpolation — this prevents template-injection attacks where user
  // code containing backticks or ${} could break out of the template literal.
  const WORKER_BOOTSTRAP = `
// Tool stubs — forward calls to main thread via message passing
const __toolNames = [] // populated by init message
const __stubs = {}
for (const name of __toolNames) {
  __stubs[name] = (args) => __callTool(name, args)
}

// Pending promise map indexed by call ID
const __pending = new Map()

function __callTool(name, args) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2) + Date.now()
    __pending.set(id, { resolve, reject })
    postMessage({ type: "tool_call", id, name, args })
  })
}

// Handle results arriving from the main thread
self.addEventListener("message", (e) => {
  const msg = e.data
  if (msg.type === "init") {
    // First message carries the user code — execute it
    __runCode(msg.code)
    return
  }
  if (msg.type === "tool_result") {
    const handler = __pending.get(msg.id)
    if (handler) {
      __pending.delete(msg.id)
      if (msg.error) handler.reject(new Error(msg.error))
      else handler.resolve(msg.result)
    }
  }
})

// Capture console output so intermediate prints are collected
const __output = []
console.log = (...args) => __output.push(args.map(String).join(" "))
console.error = (...args) => __output.push("[err] " + args.map(String).join(" "))
console.warn = (...args) => __output.push("[warn] " + args.map(String).join(" "))
console.info = (...args) => __output.push(args.map(String).join(" "))

function __runCode(code) {
  // Expose tool stubs as globals so user code can call them directly
  for (const name of __toolNames) {
    globalThis[name] = __stubs[name]
  }
  ;(async () => {
    try {
      // Use Function constructor to evaluate user code safely without
      // template interpolation — the code string is passed as a parameter
      // to the Function constructor, not interpolated into a template.
      const asyncFn = new Function("return (async () => {\\n" + code + "\\n})()")
      await asyncFn()
      postMessage({ type: "done", output: __output.join("\\n") })
    } catch (e) {
      postMessage({ type: "error", error: e?.message ?? String(e), output: __output.join("\\n") })
    }
  })()
}
`

  export async function run(input: { code: string; toolBridge: ToolBridge; timeoutMs?: number }): Promise<RunResult> {
    const start = Date.now()
    const timeoutMs = input.timeoutMs ?? 30_000
    const toolNames = Object.keys(input.toolBridge)

    // Use mkdtemp for a unique, unpredictable temp directory to prevent TOCTOU attacks
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "nikcli_exec_")).catch(() => os.tmpdir())
    const tmpFile = path.join(tmpDir, `exec_${Date.now()}.js`)

    try {
      // Inject tool names into the bootstrap script
      const script = WORKER_BOOTSTRAP.replace(
        "const __toolNames = [] // populated by init message",
        `const __toolNames = ${JSON.stringify(toolNames)}`,
      )
      await Bun.write(tmpFile, script)

      return await new Promise<RunResult>((resolve) => {
        const worker = new Worker(tmpFile)
        let settled = false

        const finish = (result: RunResult) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          worker.terminate()
          resolve(result)
        }

        const timer = setTimeout(() => {
          finish({
            stdout: "",
            stderr: `Execution timed out after ${timeoutMs}ms`,
            success: false,
            durationMs: Date.now() - start,
          })
        }, timeoutMs)

        worker.onmessage = async (e: MessageEvent) => {
          const msg = e.data as {
            type: string
            id?: string
            name?: string
            args?: unknown
            result?: string
            error?: string
            output?: string
          }

          if (msg.type === "tool_call") {
            const bridge = input.toolBridge[msg.name!]
            if (!bridge) {
              worker.postMessage({ type: "tool_result", id: msg.id, error: `Tool not found: ${msg.name}` })
              return
            }
            try {
              const result = await bridge(msg.args)
              worker.postMessage({ type: "tool_result", id: msg.id, result })
            } catch (err) {
              worker.postMessage({
                type: "tool_result",
                id: msg.id,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          } else if (msg.type === "done") {
            finish({ stdout: msg.output ?? "", stderr: "", success: true, durationMs: Date.now() - start })
          } else if (msg.type === "error") {
            finish({
              stdout: msg.output ?? "",
              stderr: msg.error ?? "Unknown error",
              success: false,
              durationMs: Date.now() - start,
            })
          }
        }

        worker.onerror = (e) => {
          log.warn("native-executor worker error", { message: e.message })
          finish({ stdout: "", stderr: e.message ?? "Worker error", success: false, durationMs: Date.now() - start })
        }

        // Send user code via postMessage — safe from template injection
        worker.postMessage({ type: "init", code: input.code })
      })
    } finally {
      await Bun.file(tmpFile)
        .delete()
        .catch(() => {})
      // Clean up temp directory
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
