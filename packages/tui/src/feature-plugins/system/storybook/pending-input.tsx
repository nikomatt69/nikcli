import { createMemo, createSignal, For, type JSX } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { PendingInputCard, type PendingInputFile } from "@tui/component/pending-input-card"
import { StoryFooter } from "./footer"
import type { Story, StoryContext } from "./story"

/**
 * Pending input — queued versus steering — from fixtures.
 *
 * This is the story worth having first, and it is ours rather than a port: `session_pending` is where
 * nikcli's admission model lives, and until now the only way to look at these cards was to make a real
 * session busy and race it. Every state below is reachable in production and none is reachable on
 * demand.
 *
 * The card is a pure component (`component/pending-input-card.tsx`); the session route supplies the
 * same props from live data. So what renders here is the production component, not a copy of it.
 */
type Fixture = {
  readonly label: string
  readonly note: string
  readonly color: RGBA
  readonly text: string
  readonly files: ReadonlyArray<PendingInputFile>
  readonly delivery: "queue" | "steer"
}

const fixtures = (accent: RGBA, secondary: RGBA): ReadonlyArray<Fixture> => [
  {
    label: "queued",
    note: "Enter with the session busy. Waits for the next safe step.",
    color: accent,
    text: "also update the changelog",
    files: [],
    delivery: "queue",
  },
  {
    label: "steering",
    note: "Ctrl/Cmd+Enter with text. Interrupts the turn and sends now.",
    color: accent,
    text: "stop — you are editing the wrong file",
    files: [],
    delivery: "steer",
  },
  {
    label: "queued with attachments",
    note: "File parts render as badges; the filename falls back to the mime type.",
    color: secondary,
    text: "use these two for the fixture",
    files: [{ filename: "report.csv", mime: "text/csv" }, { mime: "image/png" }],
    delivery: "queue",
  },
  {
    label: "long text",
    note: "Wrapping is the card's job; the row must not clip the delivery badge.",
    color: secondary,
    text: "when the build finishes, check whether the flake in the release suite is the load-dependent one we saw before, and if it is, re-run that file on its own before believing it",
    files: [],
    delivery: "queue",
  },
  {
    label: "attachment only",
    note: "No text part at all — the body collapses and the badge still reads.",
    color: accent,
    text: "",
    files: [{ filename: "trace.json", mime: "application/json" }],
    delivery: "steer",
  },
]

function PendingInputStory(props: { context: StoryContext }): JSX.Element {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const [index, setIndex] = createSignal(0)
  const all = createMemo(() => fixtures(theme.accent.fg, theme.accent.secondary))
  const current = createMemo(() => all()[index() % all().length]!)

  props.context.keymap.registerLayer({
    commands: () => [
      {
        name: "storybook.pending-input.next",
        title: "Storybook: next fixture",
        namespace: "Debug",
        hidden: true,
        run: () => setIndex((value) => (value + 1) % all().length),
      },
      {
        name: "storybook.pending-input.previous",
        title: "Storybook: previous fixture",
        namespace: "Debug",
        hidden: true,
        run: () => setIndex((value) => (value + all().length - 1) % all().length),
      },
      {
        name: "storybook.pending-input.back",
        title: "Storybook: back to index",
        namespace: "Debug",
        hidden: true,
        run: () => props.context.open(undefined),
      },
    ],
    bindings: () => [
      { key: "right", cmd: "storybook.pending-input.next", description: "Next fixture" },
      { key: "left", cmd: "storybook.pending-input.previous", description: "Previous fixture" },
      { key: "escape", cmd: "storybook.pending-input.back", description: "Back to the storybook index" },
    ],
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.surface.base}
    >
      <box paddingTop={1} paddingLeft={2} paddingRight={2} flexDirection="column" flexGrow={1}>
        <text fg={theme.foreground.muted}>{current().note}</text>
        <PendingInputCard
          id={`story-pending-${index()}`}
          color={current().color}
          text={current().text}
          files={current().files}
          delivery={current().delivery}
        />
        <box height={1} />
        <box flexDirection="row" columnGap={1} flexWrap="wrap">
          <For each={all()}>
            {(fixture, position) => (
              <text fg={position() === index() ? theme.foreground.default : theme.foreground.muted} wrapMode="none">
                {position() === index() ? "› " : "  "}
                {fixture.label}
              </text>
            )}
          </For>
        </box>
      </box>
      <StoryFooter
        title="pending input"
        details={[`${index() + 1}/${all().length}`, current().delivery]}
        message={current().label}
        controls={[
          { shortcut: "←/→", label: "fixture" },
          { shortcut: "esc", label: "index" },
        ]}
      />
    </box>
  )
}

export const pendingInputStory: Story = {
  id: "pending-input",
  title: "Pending input (queued vs steering)",
  render: (context) => <PendingInputStory context={context} />,
}
