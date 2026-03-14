import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { GithubRepoCard, LocalRepoCard } from "@/components/RepoCard"
import { useServer } from "@/lib/server-provider"
import type { GitHubRepo, ProjectInfo } from "@/lib/types"

export default function ReposScreen() {
  const { client, config, save } = useServer()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sandboxName, setSandboxName] = useState("")
  const [busy, setBusy] = useState(false)
  const [importingRepo, setImportingRepo] = useState<string | null>(null)

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
          Switch the host repo, create a fresh sandbox worktree, and inspect connected GitHub repositories.
        </Text>
        <View className="mt-4 flex-row gap-2">
          <View className="rounded-full bg-background/70 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">{projects.length} local repos</Text>
          </View>
          <View className="rounded-full bg-background/70 px-3 py-2">
            <Text className="text-[11px] font-semibold text-ink">{repos.length} GitHub repos</Text>
          </View>
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
                  disabled={Boolean(importingRepo)}
                  onPress={() => void importRepo(repo)}
                  className="flex-1 rounded-2xl bg-accent px-4 py-3"
                >
                  {importingRepo === repo.full_name ? (
                    <ActivityIndicator color="#082f49" />
                  ) : (
                    <Text className="text-center font-semibold text-slate-950">
                      {repo.imported ? "Refresh import" : "Import to host"}
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
