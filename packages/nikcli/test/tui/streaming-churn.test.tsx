import { afterAll, describe, expect, test } from "bun:test"
import { Renderable, RGBA, SyntaxStyle, type CapturedFrame } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { preserveTestEnv } from "../helpers/env"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-streaming-churn-"))
const testDatabase = path.join(testHome, "data", "nikcli.db")
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DB = testDatabase
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DB", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const [{ KVProvider }, { MessageMarkdown }, { liveMarkdown }] = await Promise.all([
  import("@tui/context/kv"),
  import("@tui/feature-plugins/math/markdown"),
  import("@tui/routes/session/diagram"),
])

const FG = RGBA.fromInts(255, 255, 255, 255)

function probe() {
  const proto = Renderable.prototype as unknown as Record<string, any>
  const destroy = proto.destroy
  let destroyed = 0
  proto.destroy = function (this: any, ...args: any[]) {
    destroyed++
    return destroy.apply(this, args)
  }
  return {
    stop() {
      proto.destroy = destroy
      return destroyed
    },
  }
}

const TOKENS = [
  "Here is the plan.\n\n",
  "First we look at the ",
  "renderer, then we ",
  "measure the churn.\n\n",
  "- one\n",
  "- two\n",
  "- three\n\n",
  "```ts\nconst x = 1\n```\n\n",
  "That is all.",
]

function paint(captureSpans: () => CapturedFrame): string {
  return captureSpans()
    .lines.map((line) =>
      line.spans
        .map((span) => span.text)
        .join("")
        .replace(/\s+$/, ""),
    )
    .filter((line) => line.trim().length > 0)
    .join("\n")
}

async function waitPaint(
  captureSpans: () => CapturedFrame,
  renderOnce: () => Promise<void>,
  timeoutMs = 1000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let output = ""
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await renderOnce()
    output = paint(captureSpans)
    if (output) return output
  }
  return output
}

describe("streaming churn", () => {
  test("plain <markdown> per token", async () => {
    const [content, setContent] = createSignal("")
    const { renderOnce } = await testRender(
      () => (
        <box width={70} height={30}>
          <markdown
            content={content()}
            streaming={true}
            syntaxStyle={SyntaxStyle.create()}
            conceal={true}
            concealCode={false}
            fg={FG}
          />
        </box>
      ),
      { width: 70, height: 30 },
    )
    await renderOnce()

    const p = probe()
    let acc = ""
    for (const token of TOKENS) {
      acc += token
      setContent(acc)
      await renderOnce()
    }
    const destroyed = p.stop()
    console.log(`plain markdown: ${destroyed} destroys over ${TOKENS.length} tokens`)
    expect(destroyed).toBeGreaterThanOrEqual(0)
  })

  test("MessageMarkdown (math off) per token", async () => {
    const [content, setContent] = createSignal("")
    const { renderOnce } = await testRender(
      () => (
        <KVProvider>
          <box width={70} height={30}>
            <MessageMarkdown
              content={content()}
              streaming={true}
              syntaxStyle={SyntaxStyle.create()}
              conceal={true}
              concealCode={false}
              fg={FG}
              tableOptions={{
                widthMode: "full",
                wrapMode: "word",
                cellPadding: 1,
                borders: true,
              }}
            />
          </box>
        </KVProvider>
      ),
      { width: 70, height: 30 },
    )
    await renderOnce()

    const p = probe()
    let acc = ""
    for (const token of TOKENS) {
      acc += token
      setContent(acc)
      await renderOnce()
    }
    const destroyed = p.stop()
    console.log(`MessageMarkdown: ${destroyed} destroys over ${TOKENS.length} tokens`)
    expect(destroyed).toBeGreaterThanOrEqual(0)
  })

  /**
   * The 02:42 recording: yellow titles at the bottom of a live answer flash
   * off because the last heading is rebuilt on every token. After the heading
   * has been painted, later chunks must not wipe it.
   */
  test("a committed heading stays painted while later tokens arrive", async () => {
    const [raw, setRaw] = createSignal("")
    const { captureSpans, renderOnce } = await testRender(
      () => (
        <KVProvider>
          <box width={72} height={24}>
            <MessageMarkdown
              content={liveMarkdown(raw(), true)}
              streaming={true}
              syntaxStyle={SyntaxStyle.create()}
              conceal={true}
              concealCode={false}
              fg={FG}
              tableOptions={{
                widthMode: "full",
                wrapMode: "word",
                cellPadding: 1,
                borders: true,
              }}
            />
          </box>
        </KVProvider>
      ),
      { width: 72, height: 24 },
    )
    await renderOnce()

    const chunks = [
      "## Live projector\n\n",
      "Subscribes to MessageV2.Event.\n\n",
      "### Index + read API\n\n",
      "User message: republish from storage.\n",
    ]

    let acc = ""
    const frames: string[] = []
    for (const chunk of chunks) {
      acc += chunk
      setRaw(acc)
      frames.push(await waitPaint(captureSpans, renderOnce))
    }

    const first = frames.findIndex((frame) => frame.includes("Live projector"))
    if (first < 0) {
      throw new Error(
        `heading never painted; frames:\n${frames.map((frame, i) => `[${i}]\n${frame || "(empty)"}`).join("\n")}`,
      )
    }
    for (const frame of frames.slice(first)) {
      expect(frame).toContain("Live projector")
    }
    expect(frames.at(-1)).toContain("Index + read API")
  })
})

afterAll(async () => {
  const { Database } = await import("@/database/database")
  Database.close(testDatabase)
  await fs.rm(testHome, { recursive: true, force: true })
})
