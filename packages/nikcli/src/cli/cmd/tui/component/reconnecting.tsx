import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useTheme } from "../context/theme";
import { Spinner } from "./spinner";

/** How long the stream must stay down before the overlay appears. The SSE
 *  retry loop in `context/sdk.tsx` starts backing off at 250ms, so a blip that
 *  self-heals on the first retry must not flash a full-screen takeover. */
const GRACE_MS = 600;

/**
 * Full-screen takeover shown while the event stream is down.
 *
 * Without it a dead server is indistinguishable from a hung TUI: the retry loop
 * reconnects silently and the only trace is a `console.warn` the user never
 * sees. Rendered above every route and dialog, since nothing on screen can be
 * trusted to be current while the stream is gone.
 */
export function Reconnecting(props: { attempt: number; error?: string }) {
  const theme = useTheme().theme;
  const [show, setShow] = createSignal(false);
  let wait: NodeJS.Timeout | undefined;

  createEffect(() => {
    // Touch `attempt` so a re-render on a later retry cannot restart the timer:
    // the grace period is measured from the first failure, not the latest one.
    void props.attempt;
    if (show() || wait) return;
    wait = setTimeout(() => {
      wait = undefined;
      setShow(true);
    }, GRACE_MS).unref();
  });

  onCleanup(() => {
    if (wait) clearTimeout(wait);
  });

  return (
    <Show when={show()}>
      <box
        position="absolute"
        zIndex={10_000}
        top={0}
        right={0}
        bottom={0}
        left={0}
        backgroundColor={theme.background}
        alignItems="center"
        justifyContent="center"
      >
        <box
          width={54}
          maxWidth="90%"
          flexDirection="column"
          alignItems="center"
          gap={1}
        >
          <text fg={theme.text}>Connection lost</text>
          <Spinner color={theme.textMuted}>Reconnecting to server...</Spinner>
          <text fg={theme.textMuted}>Attempt {props.attempt}</text>
          <Show when={props.error}>
            <text fg={theme.error} wrapMode="word">
              {props.error}
            </text>
          </Show>
        </box>
      </box>
    </Show>
  );
}
