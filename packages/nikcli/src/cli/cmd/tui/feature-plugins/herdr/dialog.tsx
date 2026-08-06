/**
 * Herdr status dialog.
 *
 * Renders the bridge's install/socket status plus the latest cached snapshot
 * of workspaces, tabs, and agents. The user can toggle the bridge, refresh
 * the snapshot, or close the dialog from this surface.
 *
 * The dialog talks to the server-side bridge directly through the
 * `@/plugin/herdr/bridge` import — the bridge is the only piece of state
 * that matters here, and it's safe to read from the TUI worker thread
 * because the bridge is process-local.
 */
import { createMemo, createResource, For, Show } from "solid-js";
import { useTheme } from "@tui/context/theme";
import { useToast } from "@tui/ui/toast";
import { HerdrBridge } from "@/plugin/herdr/bridge";
import type { HerdrInstallInfo, HerdrSnapshot } from "@/plugin/herdr/bridge";

export function DialogHerdrStatus() {
  const theme = useTheme().theme;
  const toast = useToast();
  const [info, { refetch: refetchInfo }] = createResource(() =>
    HerdrBridge.detect(),
  );
  const [snap, { refetch: refetchSnap }] = createResource(() =>
    HerdrBridge.refresh(process.cwd()),
  );
  const enabled = createMemo(() => HerdrBridge.isEnabled());

  const refresh = async () => {
    await refetchInfo();
    await refetchSnap();
  };

  const toggle = () => {
    const next = !HerdrBridge.isEnabled();
    HerdrBridge.setEnabled(next);
    toast.show({
      variant: next ? "success" : "info",
      message: next ? "Herdr bridge enabled" : "Herdr bridge disabled",
      duration: 3000,
    });
  };

  return (
    <box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
      <text fg={theme.text}>
        <b>Herdr Integration</b>
        <span style={{ fg: theme.textMuted }}> · https://herdr.dev</span>
      </text>

      <Show when={info()}>
        {(value) => <InstallBlock info={value()} theme={theme} />}
      </Show>

      <box flexDirection="row" gap={2}>
        <text fg={theme.text}>
          Bridge:{" "}
          <span style={{ fg: enabled() ? theme.success : theme.textMuted }}>
            {enabled() ? "enabled" : "disabled"}
          </span>
        </text>
      </box>

      <Show when={info()?.serverRunning}>
        <Show when={snap()}>
          {(value) => <SnapshotBlock snap={value()} theme={theme} />}
        </Show>
      </Show>

      <box flexDirection="row" gap={2}>
        <text fg={theme.primary} onMouseDown={toggle}>
          [Toggle bridge]
        </text>
        <text fg={theme.primary} onMouseDown={refresh}>
          [Refresh]
        </text>
      </box>
    </box>
  );
}

function InstallBlock(props: {
  info: HerdrInstallInfo;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const theme = props.theme;
  const info = props.info;
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.text}>
        Binary:{" "}
        <span style={{ fg: info.installed ? theme.success : theme.warning }}>
          {info.binPath ?? "(not installed)"}
        </span>
      </text>
      <text fg={theme.text}>
        Server:{" "}
        <span
          style={{ fg: info.serverRunning ? theme.success : theme.warning }}
        >
          {info.serverRunning ? "running" : "not running"}
        </span>
      </text>
      <text fg={theme.text}>
        Socket:{" "}
        <span style={{ fg: theme.textMuted }}>
          {info.socketPath ?? "(none)"}
        </span>
      </text>
    </box>
  );
}

function SnapshotBlock(props: {
  snap: HerdrSnapshot;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const theme = props.theme;
  const snap = props.snap;
  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.text}>
        <b>Snapshot</b>{" "}
        <span style={{ fg: theme.textMuted }}>
          ({snap.workspaces.length} workspaces / {snap.tabs.length} tabs /{" "}
          {snap.panes.length} panes / {snap.agents.length} agents)
        </span>
      </text>
      <Show when={snap.workspaces.length === 0}>
        <text
          fg={theme.textMuted}
        >{`No workspaces known yet. Start herdr, then refresh.`}</text>
      </Show>
      <For each={snap.workspaces}>
        {(w) => (
          <text fg={theme.text}>
            • {w.label ?? w.id}
            <Show when={w.cwd}>
              <span style={{ fg: theme.textMuted }}> — {w.cwd}</span>
            </Show>
            <Show when={w.worktree}>
              <span style={{ fg: theme.accent }}>
                {" "}
                [worktree {w.worktree!.branch}]
              </span>
            </Show>
          </text>
        )}
      </For>
      <Show when={snap.agents.length > 0}>
        <text fg={theme.text}>
          <b>Agents</b>
        </text>
        <For each={snap.agents}>
          {(a) => (
            <text fg={theme.text}>
              • {a.agent ?? "unknown"} ({a.state ?? "unknown"})
              <Show when={a.message}>
                <span style={{ fg: theme.textMuted }}> — {a.message}</span>
              </Show>
            </text>
          )}
        </For>
      </Show>
    </box>
  );
}
