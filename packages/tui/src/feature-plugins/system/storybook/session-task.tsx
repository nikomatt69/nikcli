import { createMemo, createSignal, For, type JSX } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type { RGBA } from "@opentui/core";
import { useTheme } from "@tui/context/theme";
import {
  SessionTaskCard,
  type SessionTaskKind,
} from "@tui/component/session-task-card";
import { StoryFooter } from "./footer";
import type { Story, StoryContext } from "./story";

/**
 * Nested subtask versus parallel background job, from fixtures.
 *
 * The two used to share a ◆ row plus a muted suffix. This story is the
 * production card with both kinds side by side, so the chrome difference is
 * visible without launching a real delegation.
 */
type Fixture = {
  readonly label: string;
  readonly note: string;
  readonly kind: SessionTaskKind;
  readonly color: RGBA;
  readonly agent: string;
  readonly title: string;
  readonly description: string;
  readonly detail?: string;
};

const fixtures = (accent: RGBA, info: RGBA): ReadonlyArray<Fixture> => [
  {
    label: "nested subtask",
    note: "Blocking child of this turn. Solid rail, SUBTASK chip, sits inside the message.",
    kind: "subtask",
    color: accent,
    agent: "explore",
    title: "Explore",
    description: "map how the session renderer draws delegated work",
    detail: "└ Read packages/tui/src/routes/session/index.tsx",
  },
  {
    label: "background job",
    note: "Parallel sidecar. Dashed rail, BG chip, info tint — not another nested child.",
    kind: "background",
    color: info,
    agent: "build",
    title: "implement the visual split",
    description: "keep working while this runs beside the turn",
    detail: "└ running in parallel",
  },
  {
    label: "subtask, title only",
    note: "No description — the badge and solid rail still have to read as nested.",
    kind: "subtask",
    color: accent,
    agent: "plan",
    title: "Plan",
    description: "",
  },
  {
    label: "background, long title",
    note: "The capsule must not collapse into a subtask row when the title wraps.",
    kind: "background",
    color: info,
    agent: "general",
    title: "research the auth flow across mobile and the TUI",
    description: "follow this without blocking the parent turn",
    detail: "└ synthesizing results",
  },
];

function SessionTaskStory(props: { context: StoryContext }): JSX.Element {
  const dimensions = useTerminalDimensions();
  const { theme } = useTheme();
  const [index, setIndex] = createSignal(0);
  const all = createMemo(() => fixtures(theme.accent.fg, theme.status.info.fg));
  const current = createMemo(() => all()[index() % all().length]!);

  props.context.keymap.registerLayer({
    commands: () => [
      {
        name: "storybook.session-task.next",
        title: "Storybook: next fixture",
        namespace: "Debug",
        hidden: true,
        run: () => setIndex((value) => (value + 1) % all().length),
      },
      {
        name: "storybook.session-task.previous",
        title: "Storybook: previous fixture",
        namespace: "Debug",
        hidden: true,
        run: () =>
          setIndex((value) => (value + all().length - 1) % all().length),
      },
      {
        name: "storybook.session-task.back",
        title: "Storybook: back to index",
        namespace: "Debug",
        hidden: true,
        run: () => props.context.open(undefined),
      },
    ],
    bindings: () => [
      {
        key: "right",
        cmd: "storybook.session-task.next",
        description: "Next fixture",
      },
      {
        key: "left",
        cmd: "storybook.session-task.previous",
        description: "Previous fixture",
      },
      {
        key: "escape",
        cmd: "storybook.session-task.back",
        description: "Back to the storybook index",
      },
    ],
  });

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.surface.base}
    >
      <box
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="column"
        flexGrow={1}
      >
        <text fg={theme.foreground.muted}>{current().note}</text>
        <SessionTaskCard
          kind={current().kind}
          color={current().color}
          agent={current().agent}
          title={current().title}
          description={current().description || undefined}
        >
          <ShowDetail text={current().detail} />
        </SessionTaskCard>
        <box height={1} />
        <box flexDirection="row" columnGap={1} flexWrap="wrap">
          <For each={all()}>
            {(fixture, position) => (
              <text
                fg={
                  position() === index()
                    ? theme.foreground.default
                    : theme.foreground.muted
                }
                wrapMode="none"
              >
                {position() === index() ? "› " : "  "}
                {fixture.label}
              </text>
            )}
          </For>
        </box>
      </box>
      <StoryFooter
        title="session task"
        details={[`${index() + 1}/${all().length}`, current().kind]}
        message={current().label}
        controls={[
          { shortcut: "←/→", label: "fixture" },
          { shortcut: "esc", label: "index" },
        ]}
      />
    </box>
  );
}

function ShowDetail(props: { text?: string }) {
  const { theme } = useTheme();
  if (!props.text) return null;
  return (
    <text fg={theme.foreground.muted} paddingTop={1}>
      {props.text}
    </text>
  );
}

export const sessionTaskStory: Story = {
  id: "session-task",
  title: "Session task (nested subtask vs background)",
  render: (context) => <SessionTaskStory context={context} />,
};
