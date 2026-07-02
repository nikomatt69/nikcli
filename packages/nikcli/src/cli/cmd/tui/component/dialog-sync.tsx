import { TextAttributes } from "@opentui/core";
import { useTheme } from "@tui/context/theme";
import { useRemoteSync } from "@tui/context/remote-sync";
import { For, Show, createMemo, onMount } from "solid-js";
import { useDialog } from "@tui/ui/dialog";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { FooterHint, FooterSep, FooterHintGroup } from "@tui/ui/footer-hints";

function formatAge(ts: number): string {
  const age = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  return `${Math.floor(age / 3600)}h ago`;
}

export function DialogSync() {
  const remote = useRemoteSync();
  const { theme } = useTheme();
  const dialog = useDialog();
  const dimensions = useTerminalDimensions();

  onMount(() => {
    dialog.setSize("large");
  });

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      evt.preventDefault();
      dialog.clear();
      return;
    }
    if (evt.ctrl && evt.name === "r") {
      evt.preventDefault();
      void remote.refresh();
      return;
    }
    if (evt.ctrl && evt.name === "d") {
      evt.preventDefault();
      void remote.drain();
      return;
    }
    if (evt.ctrl && evt.name === "c") {
      evt.preventDefault();
      if (remote.isConnected()) void remote.disconnect();
      else void remote.connect();
      return;
    }
  });

  const status = () => remote.status;
  const kind = createMemo(() => {
    if (!status().configured) return "unconfigured";
    if (status().connected) return "connected";
    if (status().lastError) return "error";
    return "disconnected";
  });
  const kindColor = createMemo(() => {
    const k = kind();
    if (k === "connected") return theme.success;
    if (k === "error") return theme.error;
    if (k === "disconnected") return theme.warning;
    return theme.textMuted;
  });
  const kindLabel = createMemo(() => {
    const k = kind();
    if (k === "connected") return "● connected";
    if (k === "error") return "✗ error";
    if (k === "disconnected") return "○ disconnected";
    return "— not configured";
  });

  const bodyHeight = createMemo(() =>
    Math.max(6, Math.min(28, dimensions().height - 12)),
  );

  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
      flexDirection="column"
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Sync
        </text>
        <text fg={kindColor()}>{kindLabel()}</text>
      </box>
      <text fg={theme.textMuted}>
        Unified event log for sessions + workspace, with optional hub-and-spoke
        remote
      </text>

      <Show
        when={status().configured}
        fallback={
          <box
            backgroundColor={theme.backgroundElement}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            flexDirection="column"
            gap={1}
          >
            <text fg={theme.textMuted}>
              Remote sync is optional. To enable it, set:
            </text>
            <text fg={theme.accent}>
              NIKCLI_REMOTE_URL=https://s.nikcli.store
            </text>
            <text fg={theme.accent}>
              NIKCLI_REMOTE_TOKEN=&lt;your-token&gt;
            </text>
            <text fg={theme.textMuted}>
              The local event log and the workspace lifecycle always work
              without the hub.
            </text>
          </box>
        }
      >
        <box flexDirection="row" gap={3} flexWrap="wrap">
          <Stat label="URL" value={status().url ?? "—"} />
          <Stat
            label="Outbox"
            value={`${status().pending} pending · ${status().failed} failed`}
          />
          <Stat label="Last seq" value={String(status().lastSeq)} />
          <Stat
            label="Last event"
            value={status().lastOrigin ? `${status().lastOrigin}` : "—"}
            color={
              status().lastOrigin === "remote"
                ? String(theme.accent)
                : undefined
            }
          />
        </box>

        <Show when={status().lastError}>
          <text fg={theme.error}>error: {status().lastError}</text>
        </Show>

        <box flexDirection="row" gap={2} paddingTop={1}>
          <ActionButton
            label={remote.isConnected() ? "Disconnect" : "Connect"}
            onClick={() =>
              remote.isConnected() ? remote.disconnect() : remote.connect()
            }
            accent={!remote.isConnected()}
          />
          <ActionButton
            label="Drain outbox"
            onClick={() => remote.drain()}
            disabled={status().pending === 0}
          />
          <ActionButton label="Refresh" onClick={() => remote.refresh()} />
        </box>
      </Show>

      <text fg={theme.textMuted} paddingTop={1}>
        Recent events (newest first)
      </text>
      <scrollbox
        height={bodyHeight()}
        focused={true}
        scrollbarOptions={{ visible: true }}
      >
        <Show
          when={status().events.length > 0}
          fallback={<text fg={theme.textMuted}>No events yet.</text>}
        >
          <For each={status().events}>
            {(event) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted} wrapMode="none">
                  {formatAge(event.timestamp).padStart(8)}
                </text>
                <text
                  fg={
                    event.origin === "remote"
                      ? theme.accent
                      : event.aggregateKind === "workspace"
                        ? theme.primary
                        : theme.text
                  }
                  wrapMode="none"
                >
                  {event.origin === "remote" ? "↓" : "↑"}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  [{event.aggregateKind}]
                </text>
                <text fg={theme.text} wrapMode="none">
                  {event.type}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {event.preview && event.preview !== event.type
                    ? ` ${event.preview}`
                    : ""}
                </text>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>

      <box paddingTop={1} flexDirection="row" justifyContent="space-between">
        <FooterHintGroup>
          <FooterHint keys="esc" label="close" />
          <FooterSep />
          <FooterHint keys="^c" label="connect" />
          <FooterSep />
          <FooterHint keys="^d" label="drain" />
          <FooterSep />
          <FooterHint keys="^r" label="refresh" />
        </FooterHintGroup>
        <text fg={theme.textMuted}>
          {status().events.length} events · last seq {status().lastSeq}
        </text>
      </box>
    </box>
  );
}

function Stat(props: { label: string; value: string; color?: string }) {
  const { theme } = useTheme();
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.textMuted} wrapMode="none">
        {props.label}
      </text>
      <text
        fg={props.color ?? theme.text}
        attributes={TextAttributes.BOLD}
        wrapMode="none"
      >
        {props.value}
      </text>
    </box>
  );
}

function ActionButton(props: {
  label: string;
  onClick: () => void;
  accent?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={
        props.disabled
          ? theme.backgroundPanel
          : props.accent
            ? theme.primary
            : theme.backgroundElement
      }
      onMouseUp={() => {
        if (!props.disabled) props.onClick();
      }}
    >
      <text
        fg={
          props.disabled
            ? theme.textMuted
            : props.accent
              ? theme.selectedListItemText
              : theme.text
        }
      >
        {props.label}
      </text>
    </box>
  );
}
