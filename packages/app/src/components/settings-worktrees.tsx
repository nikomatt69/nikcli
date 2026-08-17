import { Button } from "@nikcli-ai/ui/button"
import { Switch } from "@nikcli-ai/ui/switch"
import { TextField } from "@nikcli-ai/ui/text-field"
import { showToast } from "@nikcli-ai/ui/toast"
import { getFilename } from "@nikcli-ai/util/path"
import { useNavigate } from "@solidjs/router"
import { For, Show, createEffect, type Component, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { base64Encode } from "@nikcli-ai/util/encode"
import { errorMessage } from "@/pages/layout/helpers"
import { SettingsRow, useSettingsDirectory, useSettingsProject } from "./settings-helpers"

export const SettingsWorktrees: Component = () => {
  const language = useLanguage()
  const layout = useLayout()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const directory = useSettingsDirectory()
  const project = useSettingsProject()

  const [store, setStore] = createStore({
    creating: false,
    busy: undefined as string | undefined,
    startup: "",
  })

  const worktrees = createMemo(() => {
    const current = project()
    if (!current) return []
    return [current.worktree, ...(current.sandboxes ?? [])]
  })

  const workspacesEnabled = createMemo(() => {
    const current = project()
    if (!current) return false
    return current.vcs === "git" && layout.sidebar.workspaces(current.worktree)()
  })

  createEffect(() => {
    setStore("startup", project()?.commands?.start ?? "")
  })

  const labelFor = (path: string) => {
    const current = project()
    if (!current) return getFilename(path)
    if (path === current.worktree) {
      const [child] = globalSync.child(path, { bootstrap: false })
      const branch = child.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }
    return getFilename(path)
  }

  const openWorktree = (path: string) => {
    navigate(`/${base64Encode(path)}/session`)
  }

  const toggleWorkspaces = (enabled: boolean) => {
    const current = project()
    if (!current || current.vcs !== "git") return
    layout.sidebar.setWorkspaces(current.worktree, enabled)
    showToast({
      title: enabled ? language.t("toast.workspace.enabled.title") : language.t("toast.workspace.disabled.title"),
      description: enabled
        ? language.t("toast.workspace.enabled.description")
        : language.t("toast.workspace.disabled.description"),
    })
  }

  const createWorktree = async () => {
    const current = project()
    if (!current || current.vcs !== "git" || store.creating) return
    setStore("creating", true)
    if (!layout.sidebar.workspaces(current.worktree)()) {
      layout.sidebar.setWorkspaces(current.worktree, true)
    }

    const created = await globalSDK.client.worktree
      .create({ directory: current.worktree })
      .then((result) => result.data)
      .catch((err: unknown) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })

    setStore("creating", false)
    if (!created?.directory) return
    globalSync.child(created.directory)
    navigate(`/${base64Encode(created.directory)}/session`)
  }

  const resetWorktree = async (path: string) => {
    const current = project()
    if (!current || path === current.worktree || store.busy) return
    setStore("busy", path)
    const result = await globalSDK.client.worktree
      .reset({ directory: path }, { directory: current.worktree })
      .then((response) => response.data)
      .catch((err: unknown) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
    setStore("busy", undefined)
    if (!result) return
    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
    })
  }

  const deleteWorktree = async (path: string) => {
    const current = project()
    if (!current || path === current.worktree || store.busy) return
    setStore("busy", path)
    const result = await globalSDK.client.worktree
      .remove({ directory: path }, { directory: current.worktree })
      .then((response) => response.data)
      .catch((err: unknown) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
    setStore("busy", undefined)
    if (!result) return
    layout.projects.close(path)
    if (directory() === path) openWorktree(current.worktree)
  }

  const saveStartup = (value: string) => {
    const current = project()
    if (!current) return
    const start = value.trim()
    globalSync.project.meta(current.worktree, {
      commands: { start: start || undefined },
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.worktrees.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.worktrees.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full max-w-[720px]">
        <Show
          when={project()}
          fallback={
            <p class="text-14-regular text-text-weak">{language.t("settings.worktrees.empty.project")}</p>
          }
        >
          {(current) => (
            <>
              <div class="bg-surface-raised-base px-4 rounded-lg">
                <SettingsRow
                  title={language.t("settings.worktrees.enabled.title")}
                  description={language.t("settings.worktrees.enabled.description")}
                >
                  <Switch
                    checked={workspacesEnabled()}
                    disabled={current().vcs !== "git"}
                    onChange={toggleWorkspaces}
                  />
                </SettingsRow>
              </div>

              <div class="flex flex-col gap-1">
                <div class="flex items-center justify-between gap-3 pb-2">
                  <h3 class="text-14-medium text-text-strong">{language.t("settings.worktrees.section.list")}</h3>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={current().vcs !== "git" || store.creating}
                    onClick={() => void createWorktree()}
                  >
                    {store.creating
                      ? language.t("common.loading.ellipsis")
                      : language.t("session.new.worktree.create")}
                  </Button>
                </div>
                <div class="bg-surface-raised-base px-4 rounded-lg">
                  <For each={worktrees()}>
                    {(path) => {
                      const main = () => path === current().worktree
                      const active = () => path === directory()
                      return (
                        <div class="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border-weak-base last:border-none">
                          <div class="flex flex-col gap-0.5 min-w-0">
                            <span class="text-14-medium text-text-strong truncate">{labelFor(path)}</span>
                            <span class="text-12-regular text-text-weak truncate">{path}</span>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            <Button
                              size="small"
                              variant={active() ? "primary" : "secondary"}
                              onClick={() => openWorktree(path)}
                            >
                              {active()
                                ? language.t("settings.worktrees.current")
                                : language.t("settings.worktrees.open")}
                            </Button>
                            <Show when={!main()}>
                              <Button
                                size="small"
                                variant="ghost"
                                disabled={store.busy === path}
                                onClick={() => void resetWorktree(path)}
                              >
                                {language.t("common.reset")}
                              </Button>
                              <Button
                                size="small"
                                variant="ghost"
                                disabled={store.busy === path}
                                onClick={() => void deleteWorktree(path)}
                              >
                                {language.t("common.delete")}
                              </Button>
                            </Show>
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </div>

              <div class="flex flex-col gap-1">
                <h3 class="text-14-medium text-text-strong pb-2">
                  {language.t("dialog.project.edit.worktree.startup")}
                </h3>
                <TextField
                  multiline
                  description={language.t("dialog.project.edit.worktree.startup.description")}
                  placeholder={language.t("dialog.project.edit.worktree.startup.placeholder")}
                  value={store.startup}
                  onChange={(value) => setStore("startup", value)}
                  onBlur={() => saveStartup(store.startup)}
                  spellcheck={false}
                  class="max-h-20 w-full overflow-y-auto font-mono text-xs"
                />
              </div>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
