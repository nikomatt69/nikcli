import { createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"

/**
 * Non-blocking banner shown when the server event stream drops and the SDK
 * is retrying (see `sdk.connection` in context/sdk). Rendered in the same
 * bottom-overlay idiom as StartupLoading so the user keeps full context of
 * the current screen while the connection is down.
 */
export function Reconnecting(props: { attempt: number; error?: string }) {
  const theme = useTheme().theme
  // The SSE retry floor is 250ms; hold the banner back briefly so a quick
  // server bounce doesn't flash it.
  const [show, setShow] = createSignal(false)
  const timer = setTimeout(() => setShow(true), 500)
  timer.unref?.()
  onCleanup(() => clearTimeout(timer))

  return (
    <Show when={show()}>
      <box position="absolute" zIndex={6000} left={0} right={0} bottom={1} justifyContent="center" alignItems="center">
        <box
          backgroundColor={theme.backgroundPanel}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="column"
          alignItems="center"
          maxWidth="90%"
        >
          <Spinner color={theme.textMuted}>{`Connection lost — reconnecting (attempt ${props.attempt})`}</Spinner>
          <Show when={props.error}>
            <text fg={theme.error}>{props.error}</text>
          </Show>
        </box>
      </box>
    </Show>
  )
}
