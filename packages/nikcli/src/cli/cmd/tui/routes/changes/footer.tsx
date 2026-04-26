import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { FooterHint, FooterSep } from "@tui/ui/footer-hints"

export function Footer(props: {
  mode: "list" | "diff"
  hasComments: boolean
  inputOpen: boolean
  totalFiles: number
  totalAdditions: number
  totalDeletions: number
  totalComments: number
  viewMode: "unified" | "split"
  filterActive?: boolean
  filterHasText?: boolean
  reviewPanelOpen: boolean
  /** Shown when diff has comments: keyboard chord to submit review to the session. */
  reviewSubmitKeys?: string
}) {
  const reviewKeys = () => props.reviewSubmitKeys ?? "ctrl+s"
  const theme = useTheme()
  const label = () => (props.mode === "list" ? "Files" : props.inputOpen ? "Comment" : "Diff")
  const accent = () => (props.mode === "list" ? theme.theme.primary : theme.theme.diffHighlightAdded)
  const escLabel = () => {
    if (props.filterActive) return "clear"
    if (props.filterHasText) return "clear search"
    return "back"
  }

  return (
    <box
      border={["top"]}
      borderColor={theme.theme.borderSubtle}
      backgroundColor={theme.theme.backgroundPanel}
      width="100%"
      flexShrink={0}
      margin={0}
      padding={0}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        width="100%"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexWrap="wrap"
        gap={1}
      >
        <box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
          <text fg={accent()} attributes={TextAttributes.DIM} wrapMode="none">
            {label()}
          </text>
          <FooterSep />
          <FooterHint keys="tab · ← · →" label="panes" />
          <FooterSep />
          <FooterHint keys="esc" label={escLabel()} />
          <Show when={props.mode === "list" && !props.filterActive}>
            <>
              <FooterSep />
              <FooterHint keys="/" label="search" />
            </>
          </Show>
          <Show when={props.mode === "diff" && !props.inputOpen}>
            <>
              <FooterSep />
              <FooterHint keys="c" label="comment" />
            </>
          </Show>
          <Show when={props.mode === "diff" && !props.inputOpen}>
            <>
              <FooterSep />
              <FooterHint keys="s" label={props.viewMode} />
            </>
          </Show>
          <Show when={props.mode === "diff" && !props.inputOpen && props.hasComments}>
            <>
              <FooterSep />
              <FooterHint keys="n / N" label="comment nav" />
            </>
          </Show>
          <Show when={props.mode === "diff" && !props.inputOpen && props.hasComments}>
            <>
              <FooterSep />
              <FooterHint keys="r" label={props.reviewPanelOpen ? "hide review" : "show review"} />
            </>
          </Show>
          <Show when={props.mode === "diff" && !props.inputOpen}>
            <>
              <FooterSep />
              <FooterHint keys="w" label="wrap" />
            </>
          </Show>
          <Show when={props.mode === "diff" && !props.inputOpen}>
            <>
              <FooterSep />
              <FooterHint keys="g/G" label="top/end" />
            </>
          </Show>
        </box>

        <box flexDirection="row" gap={2} alignItems="center" flexShrink={0} flexWrap="wrap">
          <Show when={props.totalFiles > 0}>
            <text fg={theme.theme.textMuted} wrapMode="none">
              {`${props.totalFiles} files`}
            </text>
          </Show>
          <Show when={props.totalAdditions > 0}>
            <text fg={theme.theme.diffAdded} wrapMode="none">
              {`+${props.totalAdditions}`}
            </text>
          </Show>
          <Show when={props.totalDeletions > 0}>
            <text fg={theme.theme.diffRemoved} wrapMode="none">
              {`-${props.totalDeletions}`}
            </text>
          </Show>
          <Show when={props.totalComments > 0}>
            <text fg={theme.theme.primary} wrapMode="none">
              {`${props.totalComments} note${props.totalComments === 1 ? "" : "s"}`}
            </text>
          </Show>
          <Show when={props.mode === "diff" && props.hasComments && !props.inputOpen}>
            <box flexDirection="row" gap={0} paddingLeft={1} border={["left"]} borderColor={theme.theme.borderSubtle}>
              <text fg={theme.theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
                {reviewKeys()}
              </text>
              <text fg={theme.theme.textMuted} wrapMode="none">
                {" "}
                submit
              </text>
            </box>
          </Show>
        </box>
      </box>
    </box>
  )
}
