/**
 * Storybook — fixture-driven simulations of production TUI components.
 *
 * Ported in shape from opencode v2's `feature-plugins/system/storybook`, onto nikcli's plugin API:
 * their `Plugin.define` + `context.ui.router.register` becomes `TuiPluginModule` + `api.route.register`,
 * and stories take a narrowed {@link StoryContext} rather than the whole plugin context — a story that
 * can reach the SDK is not a fixture, it is a second copy of the app.
 *
 * The stories themselves are ours. Upstream's first story is session tabs, which nikcli has had in
 * production for a while; the state that is genuinely hard to reach here is pending input, where
 * queued-versus-steering could previously only be seen by making a real session busy and racing it.
 *
 * Two ways in:
 *   - `/storybook`, or the command palette under Debug.
 *   - `NIKCLI_STORY=<id>` at launch. That is read by `context/route.tsx` as a starting route, not
 *     navigated from here: plugin setup runs before the route provider exists, so navigating at setup
 *     raced the first render and painted an empty screen. An unknown id still lands on this route,
 *     which lists the ids that do exist — a typo must not look like an ordinary launch.
 */
import { createMemo, createSignal, For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from "@nikcli-ai/plugin/tui";
import { useTheme } from "@tui/context/theme";
import { StoryFooter } from "./footer";
import { pendingInputStory } from "./pending-input";
import { sessionTaskStory } from "./session-task";
import type { Story, StoryContext } from "./story";

const id = "internal:storybook";
const ROUTE = "storybook";

export const STORIES: ReadonlyArray<Story> = [
  pendingInputStory,
  sessionTaskStory,
];

/** The story ids a reader can pick, for the index screen and for the unknown-id message. */
export const storyIds = (): ReadonlyArray<string> =>
  STORIES.map((story) => story.id);

/**
 * Resolve `NIKCLI_STORY` against the catalog.
 *
 * Exported because this is the whole contract of the env entry point and it is worth testing without
 * a terminal: unset means do not open, a known id means open it, and anything else means open the
 * index and say what was asked for.
 */
export function resolveRequestedStory(requested: string | undefined): {
  readonly open: boolean;
  readonly story?: string;
  readonly unknown?: string;
} {
  const value = requested?.trim();
  if (!value) return { open: false };
  const match = STORIES.find((story) => story.id === value);
  if (match) return { open: true, story: match.id };
  return { open: true, unknown: value };
}

function StorybookIndex(props: { context: StoryContext; unknown?: string }) {
  const dimensions = useTerminalDimensions();
  const { theme } = useTheme();
  const [selected, setSelected] = createSignal(0);
  const count = createMemo(() => STORIES.length);

  props.context.keymap.registerLayer({
    commands: () => [
      {
        name: "storybook.index.next",
        title: "Storybook: next story",
        namespace: "Debug",
        hidden: true,
        run: () => setSelected((value) => (value + 1) % count()),
      },
      {
        name: "storybook.index.previous",
        title: "Storybook: previous story",
        namespace: "Debug",
        hidden: true,
        run: () => setSelected((value) => (value + count() - 1) % count()),
      },
      {
        name: "storybook.index.open",
        title: "Storybook: open selected story",
        namespace: "Debug",
        hidden: true,
        run: () => props.context.open(STORIES[selected()]?.id),
      },
    ],
    bindings: () => [
      { key: "down", cmd: "storybook.index.next", description: "Next story" },
      {
        key: "up",
        cmd: "storybook.index.previous",
        description: "Previous story",
      },
      {
        key: "return",
        cmd: "storybook.index.open",
        description: "Open the selected story",
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
        paddingTop={2}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="column"
        flexGrow={1}
      >
        <text fg={theme.foreground.default}>storybook</text>
        <text fg={theme.foreground.muted}>
          fixture-driven simulations of production components
        </text>
        <box height={1} />
        {/* An unknown NIKCLI_STORY must not look like a normal launch, so name it and list what exists. */}
        <Show when={props.unknown}>
          {(value) => (
            <box flexDirection="column" paddingBottom={1}>
              <text fg={theme.status.error.fg}>unknown story: {value()}</text>
              <text fg={theme.foreground.muted}>
                available: {storyIds().join(", ")}
              </text>
            </box>
          )}
        </Show>
        <For each={STORIES}>
          {(story, index) => (
            <text
              fg={
                index() === selected()
                  ? theme.foreground.default
                  : theme.foreground.muted
              }
            >
              {index() === selected() ? "› " : "  "}
              {index() + 1} {story.title}
            </text>
          )}
        </For>
      </box>
      <StoryFooter
        title="storybook"
        details={[
          `${STORIES.length} ${STORIES.length === 1 ? "story" : "stories"}`,
        ]}
        controls={[
          { shortcut: "↑/↓", label: "select" },
          { shortcut: "enter", label: "open" },
        ]}
      />
    </box>
  );
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const open = (story: string | undefined) =>
    api.route.navigate(ROUTE, story ? { story } : {});
  const context: StoryContext = { keymap: api.keymap, open };

  api.route.register([
    {
      name: ROUTE,
      render: (input) => {
        const requested = input.params?.["story"];
        const story = STORIES.find((item) => item.id === requested);
        if (story) return story.render(context);
        return (
          <StorybookIndex
            context={context}
            unknown={typeof requested === "string" ? requested : undefined}
          />
        );
      },
    },
  ]);

  api.keymap.registerLayer({
    commands: () => [
      {
        name: "storybook.open",
        title: "Open storybook",
        namespace: "Debug",
        description: "Fixture-driven simulations of production TUI components",
        slashName: "storybook",
        slashAliases: ["stories"],
        run: () => open(undefined),
      },
      ...STORIES.map((story) => ({
        name: `storybook.open.${story.id}`,
        title: `Storybook: ${story.title}`,
        namespace: "Debug",
        run: () => open(story.id),
      })),
    ],
  });
};

const plugin: TuiPluginModule & { id: string } = { id, tui };

export default plugin;
