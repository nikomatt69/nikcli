import { createMemo, For, Match, Show, Switch } from "solid-js"
import type { ColorInput, MarkdownTableOptions, SyntaxStyle } from "@opentui/core"
import { buildMathBlocks, type MathBlock } from "@nikcli-ai/tui-math"
import "@nikcli-ai/tui-math/solid"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"

/**
 * `<markdown>` that also renders LaTeX.
 *
 * Assistant answers about anything quantitative arrive full of `$…$` and
 * `$$…$$`, and the markdown renderer paints those as literal dollar signs and
 * backslashes. This component sits in the same slot and splits the message
 * first: prose still goes to `<markdown>` unchanged, formulas go to the
 * Unicode math renderable, and inline formulas short enough to fit on one row
 * are substituted into the prose so sentences stay whole.
 *
 * The split is skipped entirely when the message has no math delimiter, which
 * is nearly every message — the cost there is one scan of the text and a
 * single `<markdown>` holding the original content, exactly what the call
 * sites rendered before.
 *
 * Streaming keeps working because an unterminated formula simply has no
 * closing delimiter yet: it stays in the markdown run as raw source and
 * becomes a formula the moment the closer arrives. Only the trailing markdown
 * run is told it is streaming, since it is the only one that can still grow.
 *
 * Turn it off with `tui.math: false` in the config.
 */
export interface MathMarkdownProps {
  content: string
  streaming: boolean
  syntaxStyle: SyntaxStyle
  conceal: boolean
  concealCode: boolean
  fg: ColorInput
  tableOptions: MarkdownTableOptions
}

export function MathMarkdown(props: MathMarkdownProps) {
  const sync = useSync()
  const { theme } = useTheme()
  const enabled = createMemo(() => sync.data.config.tui?.math !== false)
  const blocks = createMemo<MathBlock[]>(() =>
    enabled() ? buildMathBlocks(props.content) : [{ type: "markdown", content: props.content }],
  )
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
          <For each={blocks()}>
            {(block, index) => (
              <Switch>
                <Match when={block.type === "markdown"}>
                  <Markdown
                    {...props}
                    content={(block as { content: string }).content}
                    streaming={props.streaming && index() === lastMarkdownIndex()}
                  />
                </Match>
                <Match when={block.type === "math"}>
                  <box
                    flexShrink={0}
                    alignSelf="flex-start"
                    marginTop={1}
                    marginBottom={1}
                    paddingLeft={(block as { display: boolean }).display ? 2 : 0}
                  >
                    <nikcli_latex
                      content={(block as { content: string }).content}
                      displayMode={(block as { display: boolean }).display}
                      foregroundColor={props.fg}
                      errorColor={theme.error}
                      fallback="source"
                    />
                  </box>
                </Match>
              </Switch>
            )}
          </For>
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
