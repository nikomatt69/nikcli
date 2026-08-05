import { describe, expect, test } from "bun:test"
import { Renderable, RGBA, SyntaxStyle } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { KVProvider } from "@tui/context/kv"
import { MessageMarkdown } from "@tui/feature-plugins/math/markdown"

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
              tableOptions={{ widthMode: "full", wrapMode: "word", cellPadding: 1, borders: true }}
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
})
