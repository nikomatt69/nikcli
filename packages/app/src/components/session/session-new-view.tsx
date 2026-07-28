import { For, Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { Icon } from "@nikcli-ai/ui/icon"
import { Mark } from "@nikcli-ai/ui/logo"
import { getDirectory, getFilename } from "@nikcli-ai/util/path"
import { usePlatform } from "@/context/platform"
import { useLocal } from "@/context/local"
import { WORK_SUGGESTIONS } from "./session-new-view-data"

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"

interface NewSessionViewProps {
  worktree: string
  onWorktreeChange: (value: string) => void
  onSuggestionSelect?: (prompt: string) => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const language = useLanguage()
  const platform = usePlatform()
  const local = useLocal()

  const sandboxes = createMemo(() => sync.project?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync.project?.worktree ?? sync.data.path.directory)
  const isWorktree = createMemo(() => {
    const project = sync.project
    if (!project) return false
    return sync.data.path.directory !== project.worktree
  })
  const desktop = createMemo(() => platform.platform === "desktop")
  const projectName = createMemo(() => getFilename(projectRoot()) || "Nikcli")
  const mode = createMemo(() => {
    const name = local.agent.current()?.name
    return name === "build" || name === "plan" || name === "ralph" ? "work" : "chat"
  })

  const setMode = (next: "chat" | "work") => {
    const available = local.agent.list()
    const names = next === "work" ? ["build", "ralph", "plan"] : ["general"]
    const agent = names.find((name) => available.some((item) => item.name === name))
    if (agent) local.agent.set(agent)
  }

  const selectSuggestion = (value: (typeof WORK_SUGGESTIONS)[number]) => {
    setMode("work")
    props.onSuggestionSelect?.(value.prompt)
  }

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return language.t("session.new.worktree.main")
      const branch = sync.data.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }

    if (value === CREATE_WORKTREE) return language.t("session.new.worktree.create")

    return getFilename(value)
  }

  return (
    <div
      data-component="session-new-view"
      classList={{
        "size-full flex flex-col flex-[1_0_0] self-stretch max-w-200 mx-auto px-6 pb-[calc(var(--prompt-height,11.25rem)+64px)]": true,
        "justify-center items-center text-center": desktop(),
        "justify-end items-start gap-4": !desktop(),
      }}
    >
      <Show
        when={desktop()}
        fallback={
          <>
            <div class="text-20-medium text-text-weaker">{language.t("command.session.new")}</div>
            <div class="flex justify-center items-center gap-3">
              <Icon name="folder" size="small" />
              <div class="text-12-medium text-text-weak select-text">
                {getDirectory(projectRoot())}
                <span class="text-text-strong">{getFilename(projectRoot())}</span>
              </div>
            </div>
            <div class="flex justify-center items-center gap-1">
              <Icon name="branch" size="small" />
              <div class="text-12-medium text-text-weak select-text ml-2">{label(current())}</div>
            </div>
            <Show when={sync.project}>
              {(project) => (
                <div class="flex justify-center items-center gap-3">
                  <Icon name="pencil-line" size="small" />
                  <div class="text-12-medium text-text-weak">
                    {language.t("session.new.lastModified")}&nbsp;
                    <span class="text-text-strong">
                      {DateTime.fromMillis(project().time.updated ?? project().time.created)
                        .setLocale(language.locale())
                        .toRelative()}
                    </span>
                  </div>
                </div>
              )}
            </Show>
          </>
        }
      >
        <div class="desktop-work-start">
          <div
            class="desktop-work-start__mode"
            role="group"
            aria-label={language.t("session.new.mode.label")}
            data-active={mode()}
          >
            <button
              type="button"
              aria-pressed={mode() === "chat"}
              classList={{
                "desktop-work-start__mode-active": mode() === "chat",
              }}
              onClick={() => setMode("chat")}
            >
              {language.t("session.new.mode.chat")}
            </button>
            <button
              type="button"
              aria-pressed={mode() === "work"}
              classList={{
                "desktop-work-start__mode-active": mode() === "work",
              }}
              onClick={() => setMode("work")}
            >
              {language.t("session.new.mode.work")}
            </button>
          </div>
          <div class="desktop-work-start__heading">
            <span class="desktop-work-start__mark">
              <Mark class="desktop-work-start__logo" />
            </span>
            <h1>{mode() === "work" ? language.t("session.new.title.work") : language.t("session.new.title.chat")}</h1>
            <p>
              <Icon name="folder" size="small" />
              {language.t("session.new.workingIn", { project: projectName() })}
            </p>
          </div>
          <Show when={mode() === "work"}>
            <div class="desktop-work-start__suggestions" aria-label={language.t("session.new.suggestions.label")}>
              <For each={WORK_SUGGESTIONS}>
                {(suggestion) => (
                  <button type="button" onClick={() => selectSuggestion(suggestion)}>
                    <span>
                      <Icon name={suggestion.icon} size="normal" />
                    </span>
                    <strong>{suggestion.title}</strong>
                    <small>{suggestion.description}</small>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
