import type { Hooks, PluginInput } from "@nikcli-ai/plugin"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { existsSync, realpathSync } from "fs"
import { spawn, spawnSync } from "child_process"
import { OAUTH_DUMMY_KEY } from "../auth"
import { Log } from "../util/log"

const log = Log.create({ service: "plugin.cursor" })

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepCli"
const AUTH_POLL_TIMEOUT_MS = 5 * 60 * 1000
const URL_EXTRACTION_TIMEOUT_MS = 10_000

const CURSOR_PROXY_HOST = "127.0.0.1"
const CURSOR_PROXY_PORT = 32124
const CURSOR_PROXY_BASE_URL = `http://${CURSOR_PROXY_HOST}:${CURSOR_PROXY_PORT}/v1`
const FORCE_TOOL_MODE = process.env.CURSOR_ACP_FORCE !== "false"

function getHomeDir() {
  const override = process.env.CURSOR_ACP_HOME_DIR
  if (override && override.length > 0) return override
  return os.homedir()
}

type CursorAgentRunner = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
}

function shouldUseSystemCursorNode() {
  const override = process.env.CURSOR_AGENT_USE_SYSTEM_NODE
  if (override === "true") return true
  if (override === "false") return false
  return os.platform() === "darwin"
}

function getCursorCompileCacheDir() {
  if (process.env.NODE_COMPILE_CACHE) return process.env.NODE_COMPILE_CACHE
  const home = getHomeDir()
  if (os.platform() === "darwin") {
    return path.join(home, "Library", "Caches", "cursor-compile-cache")
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, ".cache"), "cursor-compile-cache")
}

function resolveCursorAgentRunner(): CursorAgentRunner {
  const fallback = Bun.which("cursor-agent") ?? Bun.which("agent") ?? "cursor-agent"
  const env: NodeJS.ProcessEnv = { ...process.env }

  if (!shouldUseSystemCursorNode()) {
    return { command: fallback, args: [], env }
  }

  const node = Bun.which("node")
  if (!node || !path.isAbsolute(fallback)) {
    return { command: fallback, args: [], env }
  }

  try {
    const resolved = realpathSync(fallback)
    const entry = path.join(path.dirname(resolved), "index.js")
    if (!existsSync(entry)) {
      return { command: fallback, args: [], env }
    }
    if (!env.NODE_COMPILE_CACHE) {
      env.NODE_COMPILE_CACHE = getCursorCompileCacheDir()
    }
    return {
      command: node,
      args: ["--use-system-ca", entry],
      env,
    }
  } catch {
    return { command: fallback, args: [], env }
  }
}

function getPossibleAuthPaths() {
  const home = getHomeDir()
  const authFiles = ["cli-config.json", "auth.json"]
  const paths: string[] = []

  if (os.platform() === "darwin") {
    for (const file of authFiles) paths.push(path.join(home, ".cursor", file))
    for (const file of authFiles) paths.push(path.join(home, ".config", "cursor", file))
    return paths
  }

  for (const file of authFiles) paths.push(path.join(home, ".config", "cursor", file))

  const xdgConfig = process.env.XDG_CONFIG_HOME
  if (xdgConfig && xdgConfig !== path.join(home, ".config")) {
    for (const file of authFiles) paths.push(path.join(xdgConfig, "cursor", file))
  }

  for (const file of authFiles) paths.push(path.join(home, ".cursor", file))
  return paths
}

const CLI_CONFIG_PATHS = getPossibleAuthPaths()

interface CliConfig {
  access_token?: string
  accessToken?: string
  refresh_token?: string
  refreshToken?: string
  expires_at?: number
  expiresAt?: number
  token?: string
  authInfo?: {
    email?: string
    displayName?: string
    userId?: number
    authId?: string
  }
}

type ImportedTokens = {
  access: string
  refresh: string
  expires: number
}

async function readCliConfig(): Promise<{ path: string; config: CliConfig } | undefined> {
  for (const pathname of CLI_CONFIG_PATHS) {
    try {
      const text = await fs.readFile(pathname, "utf-8")
      const parsed = JSON.parse(text) as CliConfig
      if (parsed.access_token || parsed.accessToken || parsed.token) {
        return { path: pathname, config: parsed }
      }
    } catch {
      continue
    }
  }
  return undefined
}

function cliConfigToOAuth(config: CliConfig): ImportedTokens {
  const access = config.access_token ?? config.accessToken ?? config.token ?? ""
  const refresh = config.refresh_token ?? config.refreshToken ?? access
  let expires = config.expires_at ?? config.expiresAt ?? 0

  if (expires > 0 && expires < 1e12) {
    expires *= 1000
  }

  if (!expires) {
    expires = Date.now() + 60 * 60 * 1000
  }

  return { access, refresh, expires }
}

function hasCursorAuthInfo(config: CliConfig) {
  return Boolean(config.authInfo?.authId || config.authInfo?.email || config.authInfo?.userId)
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
}

async function pollForAuthFile(timeoutMs = AUTH_POLL_TIMEOUT_MS, intervalMs = 500): Promise<boolean> {
  const startTime = Date.now()
  return new Promise((resolve) => {
    const check = () => {
      for (const authPath of CLI_CONFIG_PATHS) {
        if (existsSync(authPath)) {
          resolve(true)
          return
        }
      }
      if (Date.now() - startTime >= timeoutMs) {
        resolve(false)
        return
      }
      setTimeout(check, intervalMs)
    }
    check()
  })
}

async function importStoredCursorSession(input: PluginInput, getAuth: () => Promise<any>) {
  let auth = await getAuth()
  if (auth) return auth

  const legacy = await readCliConfig()
  if (!legacy) return auth

  const tokens = cliConfigToOAuth(legacy.config)
  if (!tokens.access) return auth

  await input.client.auth.set({
    providerID: "cursor",
    auth: {
      type: "oauth",
      access: tokens.access,
      refresh: tokens.refresh,
      expires: tokens.expires,
    },
  })

  log.info("imported cursor token from cli config", { path: legacy.path })
  return getAuth()
}

async function refreshFromCliConfig(input: PluginInput): Promise<ImportedTokens | undefined> {
  const current = await readCliConfig()
  if (!current) return undefined

  const tokens = cliConfigToOAuth(current.config)
  await input.client.auth.set({
    providerID: "cursor",
    auth: {
      type: "oauth",
      access: tokens.access,
      refresh: tokens.refresh,
      expires: tokens.expires,
    },
  })
  return tokens
}

async function waitForCursorAuthStatus(): Promise<{ kind: "token"; tokens: ImportedTokens } | { kind: "session" }> {
  const found = await pollForAuthFile()
  if (!found) {
    throw new Error("Timed out waiting for Cursor authentication status")
  }
  const current = await readCliConfig()
  if (current) {
    const tokens = cliConfigToOAuth(current.config)
    if (tokens.access) return { kind: "token", tokens }
    if (hasCursorAuthInfo(current.config)) return { kind: "session" }
  }
  return { kind: "session" }
}

async function startCursorOAuth(): Promise<{
  url: string
  instructions: string
  callback: () => Promise<
    | { type: "success"; access: string; refresh: string; expires: number }
    | { type: "success"; key: string }
    | { type: "failed" }
  >
}> {
  return new Promise((resolve, reject) => {
    log.info("starting cursor-agent login process")

    const runner = resolveCursorAgentRunner()
    const proc = spawn(runner.command, [...runner.args, "login"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: runner.env,
    })

    let stdout = ""
    let stderr = ""
    let urlExtracted = false

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })
    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    const extractUrl = () => {
      const cleanOutput = stripAnsi(stdout).replace(/\s/g, "")
      const urlMatch = cleanOutput.match(/https:\/\/cursor\.com\/(loginDeepControl|loginDeepCli)[^\s]*/)
      return urlMatch?.[0] ?? null
    }

    const tryExtractUrl = () => {
      const url = extractUrl()
      if (!url || urlExtracted) return
      urlExtracted = true
      log.info("got cursor login url")

      resolve({
        url,
        instructions: "Click 'Continue with Cursor' in your browser to authenticate.",
        callback: async () => {
          return new Promise((resolveCallback) => {
            let settled = false
            let closed = false
            let timeout: Timer | undefined

            const resolveOnce = (
              value:
                | { type: "success"; access: string; refresh: string; expires: number }
                | { type: "success"; key: string }
                | { type: "failed" },
            ) => {
              if (settled) return
              settled = true
              if (timeout) clearTimeout(timeout)
              resolveCallback(value)
            }

            const stopProc = () => {
              if (closed) return
              try {
                proc.kill()
              } catch {}
            }

            void waitForCursorAuthStatus()
              .then((result) => {
                log.info("cursor auth detected", { kind: result.kind })
                if (result.kind === "token") {
                  resolveOnce({
                    type: "success",
                    access: result.tokens.access,
                    refresh: result.tokens.refresh,
                    expires: result.tokens.expires,
                  })
                } else {
                  resolveOnce({ type: "success", key: OAUTH_DUMMY_KEY })
                }
                stopProc()
              })
              .catch((err) => {
                log.warn("cursor auth poll failed", {
                  error: err instanceof Error ? err.message : String(err),
                })
              })

            proc.on("close", async (code) => {
              closed = true
              if (settled) return
              if (code === 0) {
                try {
                  const status = await waitForCursorAuthStatus()
                  if (status.kind === "token") {
                    resolveOnce({
                      type: "success",
                      access: status.tokens.access,
                      refresh: status.tokens.refresh,
                      expires: status.tokens.expires,
                    })
                  } else {
                    resolveOnce({ type: "success", key: OAUTH_DUMMY_KEY })
                  }
                  return
                } catch {}
              }
              resolveOnce({ type: "failed" })
            })

            timeout = setTimeout(() => {
              stopProc()
              resolveOnce({ type: "failed" })
            }, AUTH_POLL_TIMEOUT_MS)
          })
        },
      })
    }

    const urlPollStart = Date.now()
    const pollForUrl = () => {
      if (urlExtracted) return
      if (Date.now() - urlPollStart >= URL_EXTRACTION_TIMEOUT_MS) {
        proc.kill()
        const errorMsg = stderr ? stripAnsi(stderr) : "No login URL received within timeout"
        reject(new Error(`Failed to get login URL: ${errorMsg}`))
        return
      }
      tryExtractUrl()
      if (!urlExtracted) setTimeout(pollForUrl, 100)
    }
    pollForUrl()
  })
}

type StreamJsonEvent = {
  type: string
  subtype?: string
  session_id?: string
  timestamp?: number
  timestamp_ms?: number
  message?: { role: string; content: Array<{ type: string; text?: string; thinking?: string }> }
  text?: string
  tool_call?: Record<string, { args?: Record<string, unknown> }>
  call_id?: string
  is_error?: boolean
  error?: { message?: string }
}

function parseStreamJsonLine(line: string): StreamJsonEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed as StreamJsonEvent
  } catch {
    return null
  }
}

function extractText(event: StreamJsonEvent): string {
  if (!event.message?.content) return ""
  return event.message.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("")
}

function extractThinkingFromAssistant(event: StreamJsonEvent): string {
  if (!event.message?.content) return ""
  return event.message.content
    .filter((c) => c.type === "thinking" && typeof c.thinking === "string")
    .map((c) => c.thinking as string)
    .join("")
}

function inferToolName(event: StreamJsonEvent): string {
  const key = Object.keys(event.tool_call ?? {})[0]
  if (!key) return "tool"
  if (key.endsWith("ToolCall")) {
    const base = key.slice(0, -"ToolCall".length)
    return base.charAt(0).toLowerCase() + base.slice(1)
  }
  return key
}

class LineBuffer {
  private buffer = ""
  private decoder = new TextDecoder()
  push(chunk: string | Uint8Array): string[] {
    const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk)
    if (!text) return []
    this.buffer += text
    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() ?? ""
    const completed: string[] = []
    for (const line of lines) {
      const normalized = line.endsWith("\r") ? line.slice(0, -1) : line
      if (!normalized.trim()) continue
      completed.push(normalized)
    }
    return completed
  }
  flush(): string[] {
    const normalized = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer
    this.buffer = ""
    return normalized.trim() ? [normalized] : []
  }
}

class DeltaTracker {
  private lastText = ""
  private lastThinking = ""
  nextText(v: string): string {
    const d = this.diff(this.lastText, v)
    this.lastText = v
    return d
  }
  nextThinking(v: string): string {
    const d = this.diff(this.lastThinking, v)
    this.lastThinking = v
    return d
  }
  private diff(prev: string, cur: string): string {
    if (!prev) return cur
    if (cur.startsWith(prev)) return cur.slice(prev.length)
    if (prev.startsWith(cur)) return ""
    let i = 0
    const minLen = Math.min(prev.length, cur.length)
    while (i < minLen && prev[i] === cur[i]) i++
    return cur.slice(i)
  }
}

type OpenAiDelta = {
  content?: string
  reasoning_content?: string
  tool_calls?: Array<{ index: number; id: string; type: "function"; function: { name: string; arguments: string } }>
}

class StreamToSseConverter {
  private readonly id: string
  private readonly created: number
  private readonly model: string
  private readonly tracker = new DeltaTracker()
  private sawAssistantPartials = false
  private sawThinkingPartials = false

  constructor(model: string, options?: { id?: string; created?: number }) {
    this.model = model
    this.id = options?.id ?? `cursor-acp-${Date.now()}`
    this.created = options?.created ?? Math.floor(Date.now() / 1000)
  }

  handleEvent(event: StreamJsonEvent): string[] {
    if (event.type === "assistant" && event.message?.content?.some((c) => c.type === "text")) {
      const isPartial = typeof event.timestamp_ms === "number"
      if (isPartial) {
        const text = extractText(event)
        if (text) {
          this.sawAssistantPartials = true
          return [this.chunkWith({ content: text })]
        }
        return []
      }
      if (this.sawAssistantPartials) return []
      const delta = this.tracker.nextText(extractText(event))
      return delta ? [this.chunkWith({ content: delta })] : []
    }

    if (event.type === "thinking") {
      const text = event.text ?? ""
      if (typeof event.timestamp_ms === "number") {
        if (text) {
          this.sawThinkingPartials = true
          return [this.chunkWith({ reasoning_content: text })]
        }
        return []
      }
      if (this.sawThinkingPartials) return []
      const delta = this.tracker.nextThinking(text)
      return delta ? [this.chunkWith({ reasoning_content: delta })] : []
    }

    if (event.type === "assistant" && event.message?.content?.some((c) => c.type === "thinking")) {
      const isPartial = typeof event.timestamp_ms === "number"
      const text = extractThinkingFromAssistant(event)
      if (isPartial) {
        if (text) {
          this.sawThinkingPartials = true
          return [this.chunkWith({ reasoning_content: text })]
        }
        return []
      }
      if (this.sawThinkingPartials) return []
      const delta = this.tracker.nextThinking(text)
      return delta ? [this.chunkWith({ reasoning_content: delta })] : []
    }

    if (event.type === "tool_call") {
      const id = event.call_id ?? "unknown"
      const toolName = inferToolName(event)
      const toolKey = Object.keys(event.tool_call ?? {})[0]
      const args = toolKey ? event.tool_call?.[toolKey]?.args : undefined
      const argumentsText = args ? JSON.stringify(args) : ""
      return [
        this.chunkWith({
          tool_calls: [{ index: 0, id, type: "function", function: { name: toolName, arguments: argumentsText } }],
        }),
      ]
    }

    return []
  }

  private chunkWith(delta: OpenAiDelta): string {
    return `data: ${JSON.stringify({
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`
  }
}

function formatSseDone(): string {
  return "data: [DONE]\n\n"
}

function formatSseStart(model: string, options?: { id?: string; created?: number }): string {
  return `data: ${JSON.stringify({
    id: options?.id ?? `cursor-acp-${Date.now()}`,
    object: "chat.completion.chunk",
    created: options?.created ?? Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  })}\n\n`
}

function buildPromptFromMessages(messages: Array<any>, tools: Array<any>): string {
  const lines: string[] = []

  if (Array.isArray(tools) && tools.length > 0) {
    const toolDescs = tools
      .map((t: any) => {
        const fn = t.function || t
        const name = fn.name || "unknown"
        const desc = fn.description || ""
        const params = fn.parameters
        const paramStr = params ? JSON.stringify(params) : "{}"
        return `- ${name}: ${desc}\n  Parameters: ${paramStr}`
      })
      .join("\n")
    lines.push(
      `SYSTEM: You have access to the following tools. When you need to use one, respond with a tool_call in the standard OpenAI format.\nTool guidance: prefer write/edit for file changes; use bash mainly to run commands/tests.\n\nAvailable tools:\n${toolDescs}`,
    )
  }

  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "user"

    if (role === "tool") {
      const callId = message.tool_call_id || "unknown"
      const body = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")
      lines.push(`TOOL_RESULT (call_id: ${callId}): ${body}`)
      continue
    }

    if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const tcTexts = message.tool_calls.map((tc: any) => {
        const fn = tc.function || {}
        return `tool_call(id: ${tc.id || "?"}, name: ${fn.name || "?"}, args: ${fn.arguments || "{}"})`
      })
      const text = typeof message.content === "string" ? message.content : ""
      lines.push(`ASSISTANT: ${text ? text + "\n" : ""}${tcTexts.join("\n")}`)
      continue
    }

    const content = message.content
    if (typeof content === "string") {
      lines.push(`${role.toUpperCase()}: ${content}`)
    } else if (Array.isArray(content)) {
      const textParts = content
        .map((part: any) => {
          if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
            return part.text
          }
          return ""
        })
        .filter(Boolean)
      if (textParts.length) lines.push(`${role.toUpperCase()}: ${textParts.join("\n")}`)
    }
  }

  if (messages.some((m: any) => m?.role === "tool")) {
    lines.push("The above tool calls have been executed. Continue your response based on these results.")
  }

  return lines.join("\n\n")
}

function normalizeCursorModel(model: string | undefined): string {
  if (!model) return "auto"
  const cleaned = model.replace(/^cursor\//, "").replace(/^cursor-acp\//, "")
  return cleaned || "auto"
}

async function handleCursorProxyRequest(req: Request, workspaceDirectory: string): Promise<Response> {
  const bunAny = globalThis as any
  if (!bunAny.Bun?.spawn) {
    throw new Error("Cursor proxy requires Bun runtime.")
  }

  try {
    const url = new URL(req.url)

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, workspaceDirectory }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname === "/v1/models" || url.pathname === "/models") {
      const runner = resolveCursorAgentRunner()
      const proc = bunAny.Bun.spawn({
        cmd: [runner.command, ...runner.args, "models"],
        stdout: "pipe",
        stderr: "pipe",
        env: runner.env,
      })
      const output = await new Response(proc.stdout).text()
      await proc.exited
      const models: Array<{ id: string; object: string; created: number; owned_by: string }> = []
      for (const line of stripAnsi(output).split("\n")) {
        const match = line.match(/^([a-z0-9.-]+)\s+-\s+(.+?)(?:\s+\((current|default)\))*\s*$/i)
        if (match) {
          models.push({
            id: match[1],
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "cursor",
          })
        }
      }
      return new Response(JSON.stringify({ object: "list", data: models }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname !== "/v1/chat/completions" && url.pathname !== "/chat/completions") {
      return new Response(JSON.stringify({ error: `Unsupported path: ${url.pathname}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    }

    const body: any = await req.json().catch(() => ({}))
    const messages: Array<any> = Array.isArray(body?.messages) ? body.messages : []
    const stream = body?.stream === true
    const tools = Array.isArray(body?.tools) ? body.tools : []
    const prompt = buildPromptFromMessages(messages, tools)
    const model = normalizeCursorModel(body?.model)

    const runner = resolveCursorAgentRunner()
    const cmd = [
      runner.command,
      ...runner.args,
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--workspace",
      workspaceDirectory,
      "--model",
      model,
    ]
    if (FORCE_TOOL_MODE) cmd.push("--force")

    const child = bunAny.Bun.spawn({
      cmd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...bunAny.Bun.env,
        ...runner.env,
      },
    })

    child.stdin.write(prompt)
    child.stdin.end()

    if (!stream) {
      const [stdoutText, stderrText] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      const stdout = (stdoutText || "").trim()
      const stderr = (stderrText || "").trim()
      const exitCode = await child.exited

      let assistantText = ""
      let reasoningText = ""
      let sawPartials = false
      for (const line of stdout.split("\n")) {
        const event = parseStreamJsonLine(line)
        if (!event) continue
        if (event.type === "assistant" && event.message?.content?.some((c) => c.type === "text")) {
          const text = extractText(event)
          if (!text) continue
          const isPartial = typeof event.timestamp_ms === "number"
          if (isPartial) {
            assistantText += text
            sawPartials = true
          } else if (!sawPartials) {
            assistantText = text
          }
        }
        if (event.type === "thinking" && typeof event.text === "string") reasoningText += event.text
        if (event.type === "assistant" && event.message?.content?.some((c) => c.type === "thinking")) {
          reasoningText += extractThinkingFromAssistant(event)
        }
      }

      if (exitCode !== 0 && !assistantText) {
        const errSource = stderr || stdout || `cursor-agent exited with code ${exitCode}`
        return new Response(JSON.stringify({ error: stripAnsi(errSource) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      }

      const message: any = { role: "assistant", content: assistantText }
      if (reasoningText) message.reasoning_content = reasoningText

      return new Response(
        JSON.stringify({
          id: `cursor-acp-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, message, finish_reason: "stop" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }

    const id = `cursor-acp-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)
    const converter = new StreamToSseConverter(model, { id, created })

    let stderrBuffer = ""
    const stderrDrain = (async () => {
      try {
        const reader = child.stderr.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) stderrBuffer += decoder.decode(value, { stream: true })
        }
      } catch {}
    })()

    let streamClosed = false
    let stoppedByProxy = false
    const stopChild = () => {
      stoppedByProxy = true
      try {
        child.kill()
      } catch {}
    }
    const abortListener = () => stopChild()
    req.signal.addEventListener("abort", abortListener, { once: true })

    const sse = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        const lineBuffer = new LineBuffer()
        const safeEnqueue = (data: Uint8Array) => {
          if (streamClosed) return
          try {
            controller.enqueue(data)
          } catch {
            streamClosed = true
          }
        }

        safeEnqueue(encoder.encode(formatSseStart(model, { id, created })))

        void (async () => {
          try {
            const reader = child.stdout.getReader()
            while (true) {
              const { value, done } = await reader.read()
              if (done) break
              if (!value) continue
              for (const line of lineBuffer.push(value)) {
                const event = parseStreamJsonLine(line)
                if (!event) continue
                for (const out of converter.handleEvent(event)) {
                  safeEnqueue(encoder.encode(out))
                }
              }
            }
            for (const line of lineBuffer.flush()) {
              const event = parseStreamJsonLine(line)
              if (!event) continue
              for (const out of converter.handleEvent(event)) {
                safeEnqueue(encoder.encode(out))
              }
            }

            const exitCode = await child.exited
            await stderrDrain
            if (exitCode !== 0) {
              if (stoppedByProxy) {
                return
              }
              const rawStderr = stderrBuffer.trim()
              const msg = stripAnsi(
                rawStderr ||
                  `cursor-agent exited with code ${exitCode} (signal=${exitCode === 137 ? "SIGKILL" : "unknown"})`,
              )
              log.warn("cursor-agent streaming exited with error", {
                exitCode,
                stderr: msg.slice(0, 500),
                model,
              })
              const errChunk = {
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: { content: msg }, finish_reason: "stop" }],
              }
              safeEnqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`))
              safeEnqueue(encoder.encode(formatSseDone()))
              return
            }

            const doneChunk = {
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            }
            safeEnqueue(encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`))
            safeEnqueue(encoder.encode(formatSseDone()))
          } catch (err) {
            if (stoppedByProxy) {
              return
            }
            const msg = err instanceof Error ? err.message : String(err)
            log.warn("cursor-agent streaming threw", { error: msg })
            const errChunk = {
              id,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { content: msg }, finish_reason: "stop" }],
            }
            safeEnqueue(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`))
            safeEnqueue(encoder.encode(formatSseDone()))
          } finally {
            streamClosed = true
            req.signal.removeEventListener("abort", abortListener)
            try {
              controller.close()
            } catch {}
            try {
              if (!stoppedByProxy) child.kill()
            } catch {}
          }
        })()
      },
      cancel() {
        streamClosed = true
        stopChild()
      },
    })

    return new Response(sse, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}

const CURSOR_MODELS: Record<
  string,
  {
    name: string
    family: string
    context: number
    output: number
    reasoning?: boolean
    image?: boolean
  }
> = {
  "claude-sonnet-4-5": { name: "Claude Sonnet 4.5", family: "claude", context: 200_000, output: 32_000, image: true },
  "claude-sonnet-4-5-thinking": {
    name: "Claude Sonnet 4.5 (Thinking)",
    family: "claude",
    context: 200_000,
    output: 32_000,
    reasoning: true,
    image: true,
  },
  "claude-sonnet-4": { name: "Claude Sonnet 4", family: "claude", context: 200_000, output: 16_000, image: true },
  "claude-sonnet-4-thinking": {
    name: "Claude Sonnet 4 (Thinking)",
    family: "claude",
    context: 200_000,
    output: 16_000,
    reasoning: true,
    image: true,
  },
  "claude-opus-4-1": { name: "Claude Opus 4.1", family: "claude", context: 200_000, output: 32_000, image: true },
  "claude-opus-4": { name: "Claude Opus 4", family: "claude", context: 200_000, output: 32_000, image: true },
  "claude-3-5-sonnet": { name: "Claude 3.5 Sonnet", family: "claude", context: 200_000, output: 8_000, image: true },
  "gpt-5": { name: "GPT-5", family: "openai", context: 272_000, output: 32_000, image: true },
  "gpt-5.1": { name: "GPT-5.1", family: "openai", context: 272_000, output: 32_000, image: true },
  "gpt-5.2": { name: "GPT-5.2", family: "openai", context: 272_000, output: 32_000, image: true },
  "gpt-4.1": { name: "GPT-4.1", family: "openai", context: 1_047_576, output: 32_000, image: true },
  o3: { name: "OpenAI o3", family: "openai", context: 200_000, output: 100_000, reasoning: true },
  "o4-mini": { name: "OpenAI o4-mini", family: "openai", context: 200_000, output: 65_000, reasoning: true },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    family: "gemini",
    context: 1_048_576,
    output: 65_000,
    image: true,
    reasoning: true,
  },
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    family: "gemini",
    context: 1_048_576,
    output: 65_000,
    image: true,
  },
  "grok-4": { name: "Grok 4", family: "grok", context: 256_000, output: 16_000 },
  "grok-3": { name: "Grok 3", family: "grok", context: 131_072, output: 16_000 },
  "composer-1": { name: "Cursor Composer", family: "cursor", context: 200_000, output: 32_000 },
  "composer-2.5": { name: "Cursor Composer 2.5", family: "cursor", context: 200_000, output: 32_000 },
  composer: { name: "Cursor Composer", family: "cursor", context: 200_000, output: 32_000 },
  auto: { name: "Auto (cursor-agent)", family: "cursor", context: 200_000, output: 32_000 },
}

function inferFamilyFromModelId(id: string): string {
  const s = id.toLowerCase()
  if (s.includes("composer") || s === "auto" || s.includes("cursor-")) return "cursor"
  if (s.includes("claude")) return "claude"
  if (s.includes("codex")) return "openai"
  if (s.includes("gpt") || s.startsWith("o3") || s.startsWith("o4") || s.startsWith("o1")) return "openai"
  if (s.includes("gemini")) return "gemini"
  if (s.includes("grok")) return "grok"
  if (s.includes("deepseek")) return "deepseek"
  if (s.includes("llama")) return "meta"
  if (s.includes("mistral") || s.includes("codestral")) return "mistral"
  if (s.includes("qwen")) return "qwen"
  return "cursor"
}

function supportsReasoning(id: string): boolean {
  const s = id.toLowerCase()
  return (
    s.includes("thinking") ||
    s.startsWith("o1") ||
    s.startsWith("o3") ||
    s.startsWith("o4") ||
    s.includes("reasoning") ||
    s.includes("-r1")
  )
}

function supportsImage(id: string): boolean {
  const s = id.toLowerCase()
  if (s.includes("grok-3") || s.includes("grok-4")) return false
  if (s.startsWith("o3") || s.startsWith("o4")) return false
  return s.includes("claude") || s.includes("gpt-") || s.includes("gemini") || s.includes("vision")
}

function getContextWindow(id: string): { context: number; output: number } {
  const s = id.toLowerCase()
  if (s.includes("gemini-2.5") || s.includes("gemini-1.5")) return { context: 1_048_576, output: 65_000 }
  if (s.includes("gpt-4.1")) return { context: 1_047_576, output: 32_000 }
  if (s.includes("gpt-5.4")) return { context: 1_000_000, output: 32_000 }
  if (s.includes("gpt-5.3-codex") || s.includes("gpt-5.2-codex") || s.includes("gpt-5.1-codex"))
    return { context: 272_000, output: 65_000 }
  if (s.includes("gpt-5")) return { context: 272_000, output: 32_000 }
  if (s.includes("grok-4")) return { context: 256_000, output: 16_000 }
  if (s.includes("grok-3")) return { context: 131_072, output: 16_000 }
  if (s.includes("claude-opus-4-7")) return { context: 1_000_000, output: 32_000 }
  if (s.includes("claude") && s.includes("opus")) return { context: 200_000, output: 32_000 }
  if (s.includes("claude-sonnet-4") || s.includes("claude-sonnet-4-5")) return { context: 200_000, output: 32_000 }
  if (s.includes("claude-3-5") || s.includes("claude-3.5")) return { context: 200_000, output: 8_000 }
  if (s.startsWith("o3")) return { context: 200_000, output: 100_000 }
  if (s.startsWith("o4")) return { context: 200_000, output: 65_000 }
  if (s.includes("deepseek")) return { context: 128_000, output: 16_000 }
  if (s.includes("composer")) return { context: 200_000, output: 32_000 }
  return { context: 200_000, output: 16_000 }
}

function discoverCursorModelsSync(): Record<
  string,
  { name: string; family: string; context: number; output: number; reasoning: boolean; image: boolean }
> {
  const result: Record<
    string,
    { name: string; family: string; context: number; output: number; reasoning: boolean; image: boolean }
  > = {}
  try {
    const runner = resolveCursorAgentRunner()
    const out = spawnSync(runner.command, [...runner.args, "models"], {
      encoding: "utf-8",
      timeout: 15000,
      env: runner.env,
    })
    if (out.status !== 0 || !out.stdout) return result
    const clean = stripAnsi(out.stdout)
    for (const line of clean.split("\n")) {
      const m = line.match(/^\s*([a-z0-9][a-z0-9._-]*)\s+-\s+(.+?)(?:\s+\((current|default)\))*\s*$/i)
      if (!m) continue
      const id = m[1].trim()
      const name = m[2].trim()
      if (!id || id === "Model" || id === "ID") continue
      const ctx = getContextWindow(id)
      result[id] = {
        name,
        family: inferFamilyFromModelId(id),
        context: ctx.context,
        output: ctx.output,
        reasoning: supportsReasoning(id),
        image: supportsImage(id),
      }
    }
  } catch {}
  return result
}

export function cursorModelsDevProvider(): {
  id: string
  name: string
  env: string[]
  api: string
  npm: string
  models: Record<string, any>
} {
  const discovered = discoverCursorModelsSync()
  const combined: Record<
    string,
    { name: string; family: string; context: number; output: number; reasoning?: boolean; image?: boolean }
  > = {
    ...CURSOR_MODELS,
  }
  for (const [id, info] of Object.entries(discovered)) {
    combined[id] = info
  }
  if (!combined["auto"]) {
    combined["auto"] = { name: "Auto (cursor-agent)", family: "cursor", context: 200_000, output: 32_000 }
  }

  const models: Record<string, any> = {}
  for (const [id, info] of Object.entries(combined)) {
    models[id] = {
      id,
      name: info.name,
      family: info.family,
      release_date: "2025-01-01",
      attachment: info.image ?? false,
      reasoning: info.reasoning ?? false,
      tool_call: true,
      temperature: true,
      cost: { input: 0, output: 0 },
      limit: { context: info.context, output: info.output },
      modalities: {
        input: info.image ? ["text", "image"] : ["text"],
        output: ["text"],
      },
      options: {},
    }
  }
  return {
    id: "cursor",
    name: "Cursor",
    env: ["CURSOR_API_KEY"],
    api: CURSOR_PROXY_BASE_URL,
    npm: "@ai-sdk/openai-compatible",
    models,
  }
}

export async function CursorAuthPlugin(input: PluginInput): Promise<Hooks> {
  const workspaceDirectory =
    process.env.CURSOR_ACP_WORKSPACE?.trim() ||
    (typeof input.directory === "string" ? input.directory : undefined) ||
    process.cwd()

  return {
    auth: {
      provider: "cursor",
      async loader(getAuth, provider) {
        const auth = await importStoredCursorSession(input, getAuth)
        if (!auth) return {}
        if (auth.type !== "api" && auth.type !== "oauth") return {}

        for (const model of Object.values(provider.models)) {
          model.cost = { input: 0, output: 0, cache: { read: 0, write: 0 } }
        }

        return {
          apiKey: auth.type === "api" ? auth.key : OAUTH_DUMMY_KEY,
          baseURL: CURSOR_PROXY_BASE_URL,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            const currentAuth = await getAuth()
            if (currentAuth?.type === "oauth" && (!currentAuth.access || currentAuth.expires < Date.now() - 30_000)) {
              log.info("cursor token expired, reloading from cli config")
              const refreshed = await refreshFromCliConfig(input)
              if (!refreshed) {
                throw new Error("Cursor token expired. Run `/login` again or refresh via `cursor-agent login`.")
              }
            }

            return handleCursorProxyRequest(new Request(requestInput, init), workspaceDirectory)
          },
        }
      },
      methods: [
        {
          label: "Sign in with Cursor",
          type: "oauth",
          authorize: async () => {
            const result = await startCursorOAuth()
            return {
              url: result.url,
              instructions: result.instructions,
              method: "auto" as const,
              callback: result.callback,
            }
          },
        },
        {
          label: "Import existing Cursor session",
          type: "oauth",
          authorize: async () => {
            const found = await readCliConfig()
            if (!found) {
              throw new Error(
                "No existing Cursor session found. Run `cursor-agent login` first, or use the browser login above.",
              )
            }
            const tokens = cliConfigToOAuth(found.config)
            if (!tokens.access) {
              throw new Error("Existing Cursor config is missing an access token.")
            }
            return {
              url: CURSOR_LOGIN_URL,
              instructions: "Importing your existing Cursor session...",
              method: "auto" as const,
              callback: async () => ({
                type: "success" as const,
                access: tokens.access,
                refresh: tokens.refresh,
                expires: tokens.expires,
              }),
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
      ],
    },
  }
}
