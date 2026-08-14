/**
 * `<markdown>` that also renders LaTeX — mounted by the session route, gated
 * by the plugin's KV flag.
 *
 * Assistant answers about anything quantitative arrive full of `$…$` and
 * `$$…$$`, and the markdown renderer paints those as literal dollar signs and
 * backslashes. {@link MessageMarkdown} sits in the same slot: with the flag
 * off it renders the plain `<markdown>` the call site always rendered, and
 * with it on it splits the message first — prose still goes to `<markdown>`
 * unchanged, formulas go to the Unicode math renderable, and inline formulas
 * short enough to fit on one row are substituted into the prose so sentences
 * stay whole.
 *
 * The split is skipped entirely when the message has no math delimiter, which
 * is nearly every message — the cost there is one scan of the text and a
 * single `<markdown>` holding the original content.
 *
 * Streaming keeps working because an unterminated formula simply has no
 * closing delimiter yet: it stays in the markdown run as raw source and
 * becomes a formula the moment the closer arrives. Only the trailing markdown
 * run is told it is streaming, since it is the only one that can still grow.
 *
 * Toggle it with `/math`.
 */
import { createMemo, Index, Match, Show, Switch } from "solid-js"
import type { ColorInput, MarkdownTableOptions, SyntaxStyle } from "@opentui/core"
import { buildMathBlocks, type MathBlock } from "@nikcli-ai/tui-math"
import "./renderable"
import { useKV } from "@tui/context/kv"
import { useTheme } from "@tui/context/theme"
import { readEnabled } from "./store"

export interface MathMarkdownProps {
  content: string
  streaming: boolean
  syntaxStyle: SyntaxStyle
  conceal: boolean
  concealCode: boolean
  fg: ColorInput
  tableOptions: MarkdownTableOptions
}

/**
 * The component the session route mounts. Reads the plugin flag reactively:
 * off renders the exact tree the call site used before the feature existed
 * (a single `<markdown>`), on renders the math-splitting tree below. The flag
 * flips only via `/math`, never mid-stream, so the branch swap cannot churn
 * during a stream.
 */
export function MessageMarkdown(props: MathMarkdownProps) {
  const kv = useKV()
  const enabled = createMemo(() => readEnabled(kv))
  return (
    <Show when={enabled()} fallback={<Markdown {...props} />}>
      <MathMarkdown {...props} />
    </Show>
  )
}

export function MathMarkdown(props: MathMarkdownProps) {
  const { theme } = useTheme()
  const blocks = createMemo<MathBlock[]>(() => buildMathBlocks(props.content))
  // Nothing was split out, so render exactly the tree the call site used to.
  const single = createMemo(() => {
    const list = blocks()
    return list.length === 1 && list[0]!.type === "markdown" ? list[0]!.content : undefined
  })
  const lastMarkdownIndex = createMemo(() => {
    const list = blocks()
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index]!.type === "markdown") return index
    }
    return -1
  })

  return (
    <Switch>
      <Match when={single() !== undefined}>
        <Markdown {...props} content={single()!} />
      </Match>
      <Match when={single() === undefined}>
        <box flexDirection="column" flexShrink={0}>
          {/* `<Index>`, not `<For>`: blocks are positional, and `buildMathBlocks`
              allocates a fresh object for every one of them on every token. To
              `<For>`, which reconciles by reference, that reads as a completely
              new list — it would dispose and recreate every markdown renderable
              on each delta, which flickers and throws away the incremental
              parse behind `streaming`. `<Index>` keys by position and hands the
              block down as an accessor, so a growing block updates in place. */}
          <Index each={blocks()}>
            {(block, index) => (
              <Switch>
                <Match when={block().type === "markdown"}>
                  <Markdown
                    {...props}
                    content={(block() as { content: string }).content}
                    streaming={props.streaming && index === lastMarkdownIndex()}
                  />
                </Match>
                <Match when={block().type === "math"}>
                  <box
                    flexShrink={0}
                    alignSelf="flex-start"
                    marginTop={1}
                    marginBottom={1}
                    paddingLeft={(block() as { display: boolean }).display ? 2 : 0}
                  >
                    <nikcli_latex
                      content={(block() as { content: string }).content}
                      displayMode={(block() as { display: boolean }).display}
                      foregroundColor={props.fg}
                      errorColor={theme.status.error.fg}
                      fallback="source"
                    />
                  </box>
                </Match>
              </Switch>
            )}
          </Index>
        </box>
      </Match>
    </Switch>
  )
}

/** The plain markdown block, with the props every call site passes. */
function Markdown(props: MathMarkdownProps) {
  return (
    <Show when={props.content}>
      <markdown
        streaming={props.streaming}
        // Headings/lists as their own renderables. Coalesced mode stuffs the
        // whole message into one CodeRenderable and re-highlights it on every
        // token, so titles already on screen flash against the wallpaper.
        // Top-level freezes a heading once it leaves the trailing-unstable
        // window; only the block still being written keeps moving.
        internalBlockMode="top-level"
        syntaxStyle={props.syntaxStyle}
        content={props.content}
        conceal={props.conceal}
        concealCode={props.concealCode}
        fg={props.fg}
        tableOptions={props.tableOptions}
      />
    </Show>
  )
}
