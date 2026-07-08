import { createSignal, For, Show } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useLanguage } from "@tui/context/language"

type DiffFile = {
  readonly filename: string
  readonly additions: number
  readonly deletions: number
}

export function RevertBanner(props: { readonly count: number; readonly diffFiles?: readonly DiffFile[] }) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const command = useCommandDialog()
  const dialog = useDialog()
  const lang = useLanguage()
  const [hover, setHover] = createSignal(false)

  const handleUnrevert = async () => {
    const confirmed = await DialogConfirm.show(
      dialog,
      lang.t("session.revert.confirmTitle"),
      lang.t("session.revert.confirmBody"),
    )
    if (confirmed) command.trigger("session.redo")
  }

  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={handleUnrevert}
      marginTop={1}
      flexShrink={0}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.backgroundPanel}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
      >
        <text fg={theme.textMuted}>
          {lang.t(props.count === 1 ? "session.revert.bannerCount" : "session.revert.bannerCountPlural", {
            count: props.count,
          })}
        </text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> {lang.t("session.revert.bannerHint")}
        </text>
        <Show when={props.diffFiles?.length}>
          <box marginTop={1}>
            <For each={props.diffFiles}>
              {(file) => (
                <text fg={theme.text}>
                  {file.filename}
                  <Show when={file.additions > 0}>
                    <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                  </Show>
                  <Show when={file.deletions > 0}>
                    <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                  </Show>
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
    </box>
  )
}
