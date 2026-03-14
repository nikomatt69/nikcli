import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native"
import { router, useFocusEffect } from "expo-router"
import { GithubRepoCard, LocalRepoCard } from "@/components/RepoCard"
import { useServer } from "@/lib/server-provider"
import type { GitHubBranch, GitHubRepo, ProjectInfo } from "@/lib/types"

export default function ReposScreen() {
  const { client, config, bootstrap, save } = useServer()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sandboxName, setSandboxName] = useState("")
  const [busy, setBusy] = useState(false)
  const [importingRepo, setImportingRepo] = useState<string | null>(null)
  const [branchRepo, setBranchRepo] = useState<string | null>(null)
  const [branchLoading, setBranchLoading] = useState<string | null>(null)
  const [startingSessionRepo, setStartingSessionRepo] = useState<string | null>(null)
  const [branchOptions, setBranchOptions] = useState<Record<string, GitHubBranch[]>>({})
  const [baseBranchByRepo, setBaseBranchByRepo] = useState<Record<string, string>>({})

  const selectedDirectory = config?.directory

  const load = useCallback(async () => {
    if (!client) return
    try {
      setRefreshing(true)
      setError(null)
      const [projectList, githubRepos] = await Promise.all([
        client.listProjects(),
        client.listGithubRepos().catch(() => []),
      ])
      setProjects(projectList)
      setRepos(githubRepos)
      setBaseBranchByRepo((current) => {
        const next = { ...current }
        for (const repo of githubRepos) {
          if (!next[repo.full_name]) next[repo.full_name] = repo.default_branch
        }
        return next
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setRefreshing(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const selectedProject = useMemo(
    () =>
      projects.find((item) => item.worktree === selectedDirectory || item.sandboxes.includes(selectedDirectory || "")),
    [projects, selectedDirectory],
  )

  async function selectProject(project: ProjectInfo) {
    if (!config) return
    await save({ ...config, directory: project.worktree })
  }

  async function createSandbox() {
    if (!client) return
    try {
      setBusy(true)
      const worktree = await client.createWorktree(sandboxName.trim() || undefined)
      if (config) await save({ ...config, directory: worktree.directory })
      setSandboxName("")
      await load()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function useImportedRepo(repo: GitHubRepo) {
    if (!config || !repo.imported_directory) return
    await save({ ...config, directory: repo.imported_directory })
  }

  async function importRepo(repo: GitHubRepo) {
    if (!client || !config || !repo.clone_url) return
    try {
      setImportingRepo(repo.full_name)
      setError(null)
      const result = await client.importGithubRepo({
        owner: repo.full_name.split("/")[0],
        repo: repo.name,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        private: repo.private,
      })
      await save({ ...config, directory: result.import.directory })
      await load()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setImportingRepo(null)
    }
  }

  async function loadBranches(repo: GitHubRepo) {
    if (!client) return
    try {
      setBranchLoading(repo.full_name)
      setError(null)
      const owner = repo.full_name.split("/")[0]
      const branches = await client.listGithubBranches(owner, repo.name)
      setBranchOptions((current) => ({ ...current, [repo.full_name]: branches }))
      setBaseBranchByRepo((current) => ({
        ...current,
        [repo.full_name]: current[repo.full_name] || branches[0]?.name || repo.default_branch,
      }))
      setBranchRepo(repo.full_name)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBranchLoading(null)
    }
  }

  async function startGithubSession(repo: GitHubRepo) {
    if (!client || !config || !repo.clone_url) return
    try {
      setStartingSessionRepo(repo.full_name)
      setError(null)
      const owner = repo.full_name.split("/")[0]
      const baseBranch = baseBranchByRepo[repo.full_name]?.trim() || repo.default_branch
      const result = await client.createGithubSession({
        owner,
        repo: repo.name,
        cloneUrl: repo.clone_url,
        htmlUrl: repo.html_url,
        defaultBranch: repo.default_branch,
        baseBranch,
        private: repo.private,
        title: `${repo.full_name} ${baseBranch}`,
      })
      await save({ ...config, directory: result.worktree.directory })
      router.push(`/sessions/${result.session.id}`)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setStartingSessionRepo(null)
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, gap: 20 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor="#7dd3fc" />}
    >
      <View className="overflow-hidden rounded-[32px] border border-border bg-surface px-5 py-5">
        <View className="absolute -right-8 top-0 h-28 w-28 rounded-full bg-accent/15" />
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">
          Workspace portfolio
        </Text>
        <Text className="mt-2 text-[30px] font-semibold leading-[34px] text-ink">
          Direct sandboxes and source repos from your phone.
        </Text>
        <Text className="mt-3 text-sm leading-6 text-soft">
          Pick a GitHub repo, choose the base branch, create an isolated worktree session, then publish a PR when it is
          ready.
        </Text>
        <View className="mt-4 flex-row gap-2">
          <View className="rounded-full bg-background/70 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">{projects.length} local repos</Text>
          </View>
          <View className="rounded-full bg-background/70 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">{repos.length} GitHub repos</Text>
          </View>
          {bootstrap?.github.user?.login ? (
            <View className="rounded-full bg-background/70 px-3 py-2">
              <Text className="text-[11px] font-semibold text-ink">@{bootstrap.github.user.login}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {error ? <Text className="text-sm text-rose-300">{error}</Text> : null}

      <View className="rounded-[32px] border border-border bg-panel px-4 py-4">
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">New sandbox</Text>
        <Text className="mt-2 text-lg font-semibold text-ink">Create a disposable execution branch</Text>
        <Text className="mt-2 text-sm leading-6 text-soft">
          Create a disposable worktree on the host before you start a new mobile task.
        </Text>
        <TextInput
          value={sandboxName}
          onChangeText={setSandboxName}
          placeholder="Optional sandbox name"
          placeholderTextColor="#6d84a0"
          className="mt-4 rounded-2xl border border-border bg-background px-4 py-4 text-base text-ink"
        />
        <Pressable
          disabled={busy}
          onPress={() => void createSandbox()}
          className="mt-3 rounded-2xl bg-accent px-4 py-4"
        >
          {busy ? (
            <ActivityIndicator color="#082f49" />
          ) : (
            <Text className="text-center font-semibold text-slate-950">Create sandbox</Text>
          )}
        </Pressable>
        {selectedProject ? (
          <Text className="mt-3 text-xs text-soft">Current repo: {selectedProject.worktree}</Text>
        ) : null}
      </View>

      <View className="gap-3">
        <Text className="text-lg font-semibold text-ink">Local host repos</Text>
        {projects.map((project) => (
          <LocalRepoCard
            key={project.id}
            project={project}
            selected={selectedDirectory === project.worktree}
            onSelect={() => void selectProject(project)}
          />
        ))}
      </View>

      <View className="gap-3 pb-10">
        <Text className="text-lg font-semibold text-ink">GitHub account</Text>
        {repos.length ? (
          repos.slice(0, 20).map((repo) => (
            <View key={repo.id} className="gap-3 rounded-[30px] border border-border bg-surface p-3">
              <GithubRepoCard repo={repo} />
              <View className="flex-row gap-2">
                <Pressable
                  disabled={Boolean(importingRepo) || branchLoading === repo.full_name}
                  onPress={() => void loadBranches(repo)}
                  className="flex-1 rounded-2xl bg-accent px-4 py-3"
                >
                  {branchLoading === repo.full_name ? (
                    <ActivityIndicator color="#082f49" />
                  ) : (
                    <Text className="text-center font-semibold text-slate-950">Choose branch</Text>
                  )}
                </Pressable>
                <Pressable
                  disabled={Boolean(importingRepo)}
                  onPress={() => void importRepo(repo)}
                  className="flex-1 rounded-2xl border border-border bg-background/60 px-4 py-3"
                >
                  {importingRepo === repo.full_name ? (
                    <ActivityIndicator color="#7dd3fc" />
                  ) : (
                    <Text className="text-center font-semibold text-ink">
                      {repo.imported ? "Refresh import" : "Import only"}
                    </Text>
                  )}
                </Pressable>
                {repo.imported_directory ? (
                  <Pressable
                    onPress={() => void useImportedRepo(repo)}
                    className="flex-1 rounded-2xl border border-border bg-background/60 px-4 py-3"
                  >
                    <Text className="text-center font-semibold text-ink">Use repo</Text>
                  </Pressable>
                ) : null}
              </View>
              {branchRepo === repo.full_name ? (
                <View className="rounded-[24px] border border-border bg-background/60 px-4 py-4">
                  <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">
                    GitHub session
                  </Text>
                  <Text className="mt-2 text-sm leading-6 text-soft">
                    The session branch starts from the selected base branch, gets its own worktree, and can be published
                    as a pull request.
                  </Text>
                  <TextInput
                    value={baseBranchByRepo[repo.full_name] ?? repo.default_branch}
                    onChangeText={(value) =>
                      setBaseBranchByRepo((current) => ({
                        ...current,
                        [repo.full_name]: value,
                      }))
                    }
                    autoCapitalize="none"
                    placeholder="Base branch"
                    placeholderTextColor="#6d84a0"
                    className="mt-4 rounded-2xl border border-border bg-surface px-4 py-4 text-base text-ink"
                  />
                  {branchOptions[repo.full_name]?.length ? (
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {branchOptions[repo.full_name].slice(0, 8).map((branch) => (
                        <Pressable
                          key={branch.name}
                          onPress={() =>
                            setBaseBranchByRepo((current) => ({
                              ...current,
                              [repo.full_name]: branch.name,
                            }))
                          }
                          className={`rounded-full px-3 py-2 ${
                            (baseBranchByRepo[repo.full_name] ?? repo.default_branch) === branch.name
                              ? "bg-accent/15"
                              : "bg-surface"
                          }`}
                        >
                          <Text
                            className={`text-[11px] font-semibold ${
                              (baseBranchByRepo[repo.full_name] ?? repo.default_branch) === branch.name
                                ? "text-accent-light"
                                : "text-ink"
                            }`}
                          >
                            {branch.name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <Pressable
                    disabled={startingSessionRepo === repo.full_name}
                    onPress={() => void startGithubSession(repo)}
                    className="mt-4 rounded-2xl bg-accent px-4 py-4"
                  >
                    {startingSessionRepo === repo.full_name ? (
                      <ActivityIndicator color="#082f49" />
                    ) : (
                      <Text className="text-center font-semibold text-slate-950">Start GitHub session</Text>
                    )}
                  </Pressable>
                </View>
              ) : null}
              {repo.imported_directory ? (
                <Text className="text-xs text-soft">Imported at {repo.imported_directory}</Text>
              ) : null}
            </View>
          ))
        ) : (
          <View className="rounded-3xl border border-dashed border-border bg-surface px-5 py-6">
            <Text className="text-sm leading-6 text-soft">
              Add a GitHub token in Settings to browse repositories from your phone.
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  )
}
