import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native"
import { router, useFocusEffect, useRootNavigationState } from "expo-router"
import { RepoCardSkeleton } from "@/components/RepoCardSkeleton"
import { ActionButton } from "@/components/ui/ActionButton"
import { Divider } from "@/components/ui/Divider"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { ListRow, StatusDot } from "@/components/ui/ListRow"
import { SectionHeader } from "@/components/ui/SectionHeader"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { AppHeader } from "@/components/layout/AppHeader"
import { ScreenBrandHeader, SettingsCircleButton } from "@/components/layout/ScreenBrandHeader"
import { projectDirectoryForWorktree } from "@/lib/client"
import { useServer } from "@/lib/server-context"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import type { GitHubBranch, GitHubRepo, ProjectInfo } from "@/lib/types"
import { relativeTime } from "@/lib/types"

const EMPTY_ROWS: never[] = []

function safeOwner(fullName?: string): string | null {
  if (!fullName) return null
  const owner = fullName.split("/")[0]?.trim()
  return owner || null
}

function projectLabel(project: ProjectInfo): string {
  return project.name || project.worktree.split("/").filter(Boolean).pop() || project.worktree
}

function currentProjectLabel(project: ProjectInfo | undefined) {
  if (!project) return "No workspace selected"
  return projectLabel(project)
}

function repoSubtitle(repo: GitHubRepo): string {
  const parts = [
    repo.language,
    `${repo.stargazers_count.toLocaleString()} stars`,
    repo.updated_at ? relativeTime(new Date(repo.updated_at).getTime()) : null,
  ].filter(Boolean)
  return parts.join(" · ")
}

export default function ReposScreen() {
  const { palette } = useAppTheme()
  const { client, config, bootstrap, save, loading, bootstrapLoading } = useServer()
  const rootNavigationState = useRootNavigationState()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [githubError, setGithubError] = useState<string | null>(null)
  const [sandboxName, setSandboxName] = useState("")
  const [busy, setBusy] = useState(false)
  const [importingRepo, setImportingRepo] = useState<string | null>(null)
  const [branchRepo, setBranchRepo] = useState<string | null>(null)
  const [branchLoading, setBranchLoading] = useState<string | null>(null)
  const [startingSessionRepo, setStartingSessionRepo] = useState<string | null>(null)
  const [branchOptions, setBranchOptions] = useState<Record<string, GitHubBranch[]>>({})
  const [baseBranchByRepo, setBaseBranchByRepo] = useState<Record<string, string>>({})
  const [sessionTitleByRepo, setSessionTitleByRepo] = useState<Record<string, string>>({})
  const [repoSearch, setRepoSearch] = useState("")
  const [sandboxAction, setSandboxAction] = useState<string | null>(null)

  const selectedDirectory = config?.directory
  const executionTarget = config?.executionTarget ?? "local"
  const containerReady = Boolean(bootstrap?.execution?.container?.available)

  const load = useCallback(async () => {
    if (!client) {
      setProjects([])
      setRepos([])
      setError(null)
      return
    }

    try {
      setRefreshing(true)
      setError(null)
      setGithubError(null)
      const projectList = await client.listProjects()
      let githubRepos: Awaited<ReturnType<typeof client.listGithubRepos>> = []
      try {
        githubRepos = await client.listGithubRepos()
      } catch (githubLoadError) {
        setGithubError(githubLoadError instanceof Error ? githubLoadError.message : String(githubLoadError))
      }
      setProjects(projectList)
      setRepos(githubRepos)
      setBaseBranchByRepo((current) => {
        const next = { ...current }
        for (const repo of githubRepos) {
          const fullName = repo.full_name || repo.name
          if (!next[fullName]) next[fullName] = repo.default_branch || "main"
        }
        return next
      })
      setSessionTitleByRepo((current) => {
        const next = { ...current }
        for (const repo of githubRepos) {
          const fullName = repo.full_name || repo.name
          if (!next[fullName]) next[fullName] = `${fullName} ${repo.default_branch || "main"}`
        }
        return next
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setRefreshing(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      if (!rootNavigationState?.key) return
      if (loading) return
      if (!config) {
        setProjects([])
        setRepos([])
        router.replace("/")
        return
      }
      void load()
    }, [config, load, loading, rootNavigationState?.key]),
  )

  const selectedProject = useMemo(
    () =>
      projects.find((item) => {
        const sandboxes = Array.isArray(item.sandboxes) ? item.sandboxes : []
        return item.worktree === selectedDirectory || sandboxes.includes(selectedDirectory || "")
      }),
    [projects, selectedDirectory],
  )

  const visibleRepos = useMemo(() => {
    const term = repoSearch.trim().toLowerCase()
    if (!term) return repos
    return repos.filter((repo) =>
      [repo.full_name || repo.name || "", repo.language || "", repo.description || ""].some((value) =>
        value.toLowerCase().includes(term),
      ),
    )
  }, [repoSearch, repos])

  const selectedRepo = useMemo(
    () => repos.find((repo) => (repo.full_name || repo.name) === branchRepo) ?? null,
    [branchRepo, repos],
  )

  async function selectProject(project: ProjectInfo) {
    if (!config) return
    await save({ ...config, directory: project.worktree })
  }

  async function createSandbox() {
    if (!client) return
    const projectDirectory =
      projectDirectoryForWorktree(projects, selectedDirectory, selectedProject ?? bootstrap?.currentProject) ??
      selectedProject?.worktree
    if (!projectDirectory) {
      setError("Select a workspace before creating a sandbox.")
      return
    }

    try {
      setBusy(true)
      setError(null)
      const worktree = await client.createWorktree({
        name: sandboxName.trim() || undefined,
        projectDirectory,
      })
      if (config) await save({ ...config, directory: worktree.directory })
      setSandboxName("")
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBusy(false)
    }
  }

  async function resetSandbox(directory: string) {
    if (!client || !selectedProject) return
    try {
      setSandboxAction(directory)
      setError(null)
      await client.resetWorktree(directory, selectedProject.worktree)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSandboxAction(null)
    }
  }

  async function removeSandbox(directory: string) {
    if (!client || !selectedProject) return
    try {
      setSandboxAction(directory)
      setError(null)
      await client.removeWorktree(directory, selectedProject.worktree)
      if (config?.directory === directory) {
        await save({ ...config, directory: selectedProject.worktree })
      }
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSandboxAction(null)
    }
  }

  async function handleImportedRepo(repo: GitHubRepo) {
    if (!config || !repo.imported_directory) return
    await save({ ...config, directory: repo.imported_directory })
  }

  async function importRepo(repo: GitHubRepo) {
    if (!client || !config || !repo.clone_url) return
    if (executionTarget === "container" && !containerReady) {
      setError("Container sandbox requires Docker or Podman on the server. Switch back to local in Settings.")
      return
    }
    const owner = safeOwner(repo.full_name)
    if (!owner) {
      setError("Invalid repository owner")
      return
    }

    try {
      setImportingRepo(repo.full_name)
      setError(null)
      const result = await client.importGithubRepo({
        owner,
        repo: repo.name,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch || "main",
        private: repo.private,
      })
      await save({ ...config, directory: result.import.directory })
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setImportingRepo(null)
    }
  }

  async function loadBranches(repo: GitHubRepo) {
    if (!client) return
    const owner = safeOwner(repo.full_name)
    if (!owner) {
      setError("Invalid repository owner")
      return
    }

    try {
      setBranchLoading(repo.full_name)
      setError(null)
      const branches = await client.listGithubBranches(owner, repo.name)
      setBranchOptions((current) => ({ ...current, [repo.full_name]: branches }))
      setBaseBranchByRepo((current) => ({
        ...current,
        [repo.full_name]: current[repo.full_name] || branches[0]?.name || repo.default_branch || "main",
      }))
      setSessionTitleByRepo((current) => ({
        ...current,
        [repo.full_name]: current[repo.full_name] || `${repo.full_name} ${repo.default_branch || "main"}`,
      }))
      setBranchRepo(repo.full_name)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setBranchLoading(null)
    }
  }

  async function startGithubSession(repo: GitHubRepo) {
    if (!client || !config || !repo.clone_url) return
    const owner = safeOwner(repo.full_name)
    if (!owner) {
      setError("Invalid repository owner")
      return
    }

    try {
      setStartingSessionRepo(repo.full_name)
      setError(null)
      const baseBranch = baseBranchByRepo[repo.full_name]?.trim() || repo.default_branch || "main"
      const result = await client.createGithubSession({
        owner,
        repo: repo.name,
        cloneUrl: repo.clone_url,
        htmlUrl: repo.html_url,
        defaultBranch: repo.default_branch || "main",
        baseBranch,
        private: repo.private,
        title: sessionTitleByRepo[repo.full_name]?.trim() || `${repo.full_name} ${baseBranch}`,
        executionTarget,
      })
      await save({ ...config, directory: result.worktree.directory })
      router.push(`/sessions/${result.session.id}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setStartingSessionRepo(null)
    }
  }

  return (
    <View className="flex-1 bg-background px-4 pt-4">
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={EMPTY_ROWS}
        keyExtractor={() => "_"}
        renderItem={() => null}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={useMemo(
          () => (
            <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={palette.accent} />
          ),
          [refreshing, load, palette.accent],
        )}
        ListHeaderComponent={
          <View style={{ gap: 20 }}>
            <ScreenBrandHeader title="Workspaces" right={<SettingsCircleButton />} />
            <AppHeader
              className=""
              chips={[
                { label: `${projects.length} workspaces`, tone: "accent" },
                { label: `${repos.length} GitHub sources` },
                { label: currentProjectLabel(selectedProject) },
                { label: executionTarget === "container" ? "Container" : "Local" },
                bootstrap?.github?.user?.login ? { label: `@${bootstrap.github.user.login}`, tone: "good" } : null,
              ]}
            />

            {error ? <ErrorBanner message={error} /> : null}
            {githubError ? (
              <ErrorBanner
                message={`Could not load GitHub repositories: ${githubError}`}
                actionLabel="Open GitHub settings"
                onAction={() => router.push("/more/settings/github")}
              />
            ) : null}

            <SurfaceCard
              eyebrow="New sandbox"
              title="Create an isolated worktree"
              description="Start new work without changing the selected repository."
              tone="panel"
            >
              <TextField
                value={sandboxName}
                onChangeText={setSandboxName}
                placeholder="Optional sandbox name"
                label="Sandbox name"
              />
              <View className="mt-3">
                <ActionButton label="Create sandbox" loading={busy} onPress={() => void createSandbox()} />
              </View>
              {selectedProject ? (
                <Text className="mt-3 text-xs text-soft">Parent workspace: {selectedProject.worktree}</Text>
              ) : (
                <Text className="mt-3 text-xs text-soft">Select a workspace below before creating a sandbox.</Text>
              )}
            </SurfaceCard>

            {selectedProject && selectedProject.sandboxes.length > 0 ? (
              <View>
                <SectionHeader label="Sandboxes" />
                {selectedProject.sandboxes.map((sandbox, index) => (
                  <View key={sandbox}>
                    {index > 0 ? <Divider inset={24} /> : null}
                    <ListRow
                      leading={
                        <StatusDot
                          color={selectedDirectory === sandbox ? palette.secondary : hexToRgba(palette.ink, 0.25)}
                        />
                      }
                      title={sandbox.split("/").filter(Boolean).pop() || sandbox}
                      subtitle={sandbox}
                      trailing={
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <ActionButton
                            label="Reset"
                            variant="secondary"
                            loading={sandboxAction === sandbox}
                            disabled={sandboxAction !== null && sandboxAction !== sandbox}
                            onPress={() => void resetSandbox(sandbox)}
                          />
                          <ActionButton
                            label="Remove"
                            variant="danger"
                            loading={sandboxAction === sandbox}
                            disabled={sandboxAction !== null && sandboxAction !== sandbox}
                            onPress={() => void removeSandbox(sandbox)}
                          />
                        </View>
                      }
                      onPress={() => config && void save({ ...config, directory: sandbox })}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            <View>
              <SectionHeader label="Server workspaces" />
              {loading || bootstrapLoading ? <RepoCardSkeleton count={2} /> : null}
              {!loading && !bootstrapLoading && projects.length === 0 ? (
                <EmptyState
                  title="No workspaces yet"
                  description="Point the server at a workspace, import a repository, or create a sandbox to seed the hosted portfolio."
                />
              ) : null}
              {projects.map((project, index) => (
                <View key={project.id}>
                  {index > 0 ? <Divider inset={24} /> : null}
                  <ListRow
                    leading={
                      <StatusDot
                        color={
                          selectedDirectory === project.worktree ? palette.secondary : hexToRgba(palette.ink, 0.25)
                        }
                      />
                    }
                    title={projectLabel(project)}
                    subtitle={project.worktree}
                    trailing={
                      selectedDirectory === project.worktree || project.sandboxes.includes(selectedDirectory || "") ? (
                        <InfoChip label="Selected" tone="accent" />
                      ) : undefined
                    }
                    onPress={() => void selectProject(project)}
                  />
                </View>
              ))}
            </View>

            <View className="gap-3 pb-10">
              <SectionHeader label="GitHub account" />
              {!bootstrap?.github?.connected ? (
                <EmptyState
                  title="Connect GitHub first"
                  description="Open Settings to enable OAuth or install a server token, then come back here to browse repositories and launch branch-native sessions."
                  action={
                    <ActionButton label="Open GitHub settings" onPress={() => router.push("/more/settings/github")} />
                  }
                />
              ) : (
                <SurfaceCard
                  eyebrow="Source control"
                  title="Browse and launch branch sessions"
                  description="Search your GitHub inventory, choose the base branch, and create an isolated worktree session that is ready to publish back as a pull request."
                  tone="panel"
                >
                  <TextField
                    value={repoSearch}
                    onChangeText={setRepoSearch}
                    placeholder="Search repositories, languages, or descriptions"
                    autoCapitalize="none"
                  />
                  <Text className="mt-3 text-xs leading-5 text-soft">
                    {executionTarget === "container"
                      ? containerReady
                        ? "New GitHub sessions will keep the same server worktree flow but execute inside a same-server container sandbox."
                        : "Container mode is selected, but the server has no Docker or Podman runtime available right now."
                      : "New GitHub sessions use the current server worktree flow for execution and publish."}
                  </Text>
                </SurfaceCard>
              )}

              {selectedRepo ? (
                <SurfaceCard
                  eyebrow="Guided launch"
                  title={selectedRepo.full_name}
                  description="Lock the base branch, name the execution track, and launch a GitHub session with a dedicated worktree and publish path."
                  tone="panel"
                >
                  <View className="flex-row flex-wrap gap-2">
                    <InfoChip label="1. Repo selected" tone="accent" />
                    <InfoChip label="2. Choose branch" />
                    <InfoChip label="3. Launch session" />
                    <InfoChip label={executionTarget === "container" ? "Container sandbox" : "Local worktree"} />
                  </View>

                  <View className="mt-4 gap-3">
                    <TextField
                      label="Session title"
                      value={
                        sessionTitleByRepo[selectedRepo.full_name] ??
                        `${selectedRepo.full_name} ${selectedRepo.default_branch || "main"}`
                      }
                      onChangeText={(value) =>
                        setSessionTitleByRepo((current) => ({
                          ...current,
                          [selectedRepo.full_name]: value,
                        }))
                      }
                      autoCapitalize="sentences"
                      placeholder="Session title"
                    />

                    <TextField
                      label="Base branch"
                      value={baseBranchByRepo[selectedRepo.full_name] ?? (selectedRepo.default_branch || "main")}
                      onChangeText={(value) =>
                        setBaseBranchByRepo((current) => ({
                          ...current,
                          [selectedRepo.full_name]: value,
                        }))
                      }
                      autoCapitalize="none"
                      placeholder="Base branch"
                    />
                  </View>

                  {branchOptions[selectedRepo.full_name]?.length ? (
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {branchOptions[selectedRepo.full_name].slice(0, 10).map((branch) => {
                        const active =
                          (baseBranchByRepo[selectedRepo.full_name] ?? (selectedRepo.default_branch || "main")) ===
                          branch.name
                        return (
                          <ActionButton
                            key={branch.name}
                            label={branch.name}
                            variant={active ? "primary" : "secondary"}
                            className="px-3 py-2"
                            onPress={() =>
                              setBaseBranchByRepo((current) => ({
                                ...current,
                                [selectedRepo.full_name]: branch.name,
                              }))
                            }
                          />
                        )
                      })}
                    </View>
                  ) : null}

                  <View className="mt-4 rounded-[8px] border border-border bg-background/70 p-4">
                    <Text className="text-[12px] font-medium text-muted">Launch summary</Text>
                    <Text className="mt-2 text-sm leading-6 text-soft">
                      {`Worktree source: ${selectedRepo.full_name} from ${baseBranchByRepo[selectedRepo.full_name] ?? (selectedRepo.default_branch || "main")}.`}
                    </Text>
                    <Text className="mt-1 text-sm leading-6 text-soft">
                      Session title:{" "}
                      {sessionTitleByRepo[selectedRepo.full_name] ??
                        `${selectedRepo.full_name} ${selectedRepo.default_branch || "main"}`}
                    </Text>
                    <Text className="mt-1 text-sm leading-6 text-soft">
                      Execution target:{" "}
                      {executionTarget === "container" ? "same-server container sandbox" : "server worktree"}.
                    </Text>
                  </View>

                  <View className="mt-4 flex-row gap-2">
                    <View className="flex-1">
                      <ActionButton
                        label={selectedRepo.imported ? "Refresh import" : "Import only"}
                        variant="secondary"
                        loading={importingRepo === selectedRepo.full_name}
                        onPress={() => void importRepo(selectedRepo)}
                        disabled={Boolean(importingRepo)}
                      />
                    </View>
                    {selectedRepo.imported_directory ? (
                      <View className="flex-1">
                        <ActionButton
                          label="Use workspace"
                          variant="secondary"
                          onPress={() => void handleImportedRepo(selectedRepo)}
                        />
                      </View>
                    ) : null}
                  </View>
                  {selectedRepo.imported_directory ? (
                    <Text className="mt-2 text-xs text-soft">Imported at {selectedRepo.imported_directory}</Text>
                  ) : null}

                  <View className="mt-3 flex-row gap-2">
                    <View className="flex-1">
                      <ActionButton label="Close wizard" variant="secondary" onPress={() => setBranchRepo(null)} />
                    </View>
                    <View className="flex-1">
                      <ActionButton
                        label="Launch GitHub session"
                        loading={startingSessionRepo === selectedRepo.full_name}
                        onPress={() => void startGithubSession(selectedRepo)}
                      />
                    </View>
                  </View>
                </SurfaceCard>
              ) : null}

              {loading || bootstrapLoading ? <RepoCardSkeleton count={3} /> : null}
              {!loading && !bootstrapLoading && bootstrap?.github?.connected && visibleRepos.length === 0 ? (
                <EmptyState
                  title="No repositories matched"
                  description="Adjust your search, reconnect GitHub if needed, or refresh the control plane from Settings."
                />
              ) : null}
              {visibleRepos.slice(0, 20).map((repo, index) => (
                <View key={repo.id}>
                  {index > 0 ? <Divider inset={24} /> : null}
                  <ListRow
                    leading={<StatusDot color={repo.imported ? palette.success : hexToRgba(palette.ink, 0.25)} />}
                    title={repo.full_name || repo.name}
                    subtitle={repoSubtitle(repo)}
                    trailing={
                      branchLoading === repo.full_name ? (
                        <ActivityIndicator size="small" color={palette.muted} />
                      ) : repo.imported ? (
                        <InfoChip label="Imported" tone="good" />
                      ) : undefined
                    }
                    showChevron
                    onPress={() => void loadBranches(repo)}
                    disabled={Boolean(importingRepo) || branchLoading === repo.full_name}
                  />
                </View>
              ))}
            </View>
          </View>
        }
      />
    </View>
  )
}
