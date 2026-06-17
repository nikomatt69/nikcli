import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type SkillSummary } from "../lib/studio-api"
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  PageSpinner,
  btnDangerSm,
  btnPrimary,
  emptyIcons,
  inputClass,
} from "./ui"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function SkillsPageInner() {
  const { token, serverUrl } = useAuth()
  const isConnected = isDev || (!!token && !!serverUrl)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newContent, setNewContent] = useState("")
  const [busy, setBusy] = useState(false)

  const load = () => {
    if (!isConnected) {
      setLoading(false)
      return
    }
    setLoading(true)
    studioApi.skills
      .list()
      .then((d) => setSkills(d.skills))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [token, serverUrl])

  const createSkill = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      await studioApi.skills.create(newName.trim(), newDesc, newContent)
      window.posthog?.capture("skill_created", { skill_name: newName.trim() })
      setNewName("")
      setNewDesc("")
      setNewContent("")
      setShowCreate(false)
      load()
    } catch (e) {
      window.posthog?.captureException(e)
      setError(e instanceof Error ? e.message : "Create failed")
    } finally {
      setBusy(false)
    }
  }

  const deleteSkill = async (name: string) => {
    if (!confirm(`Delete skill "${name}"?`)) return
    try {
      await studioApi.skills.delete(name)
      window.posthog?.capture("skill_deleted", { skill_name: name })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed")
    }
  }

  if (!isConnected) {
    return (
      <EmptyState
        icon={emptyIcons.lock}
        title="Not connected"
        description="Configure server connection in Settings to manage skills."
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Skills"
        title="Reusable skills"
        description="Create and manage reusable skill prompts that nikcli agents can invoke."
        actions={
          <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary}>
            {showCreate ? "Cancel" : "+ New Skill"}
          </button>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {showCreate && (
        <Card className="space-y-4">
          <h3 className="font-semibold text-terminal-text">New Skill</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Skill name"
            className={inputClass}
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className={inputClass}
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={8}
            placeholder="Skill content (Markdown)..."
            className={`${inputClass} font-mono`}
          />
          <button onClick={createSkill} disabled={busy} className={btnPrimary}>
            {busy ? "Creating…" : "Create Skill"}
          </button>
        </Card>
      )}

      {loading ? (
        <PageSpinner />
      ) : skills.length === 0 ? (
        <EmptyState icon={emptyIcons.brain} title="No skills" description="Create a skill to get started." />
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => (
            <Card key={skill.name} className={`p-5 ${skill.disabled ? "opacity-50" : ""}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-terminal-text">{skill.name}</span>
                    {skill.category && <Badge>{skill.category}</Badge>}
                    {skill.tags?.map((tag) => <Badge key={tag}>{tag}</Badge>)}
                  </div>
                  {skill.description && <p className="mt-1 text-sm text-terminal-muted">{skill.description}</p>}
                  {skill.path && <code className="mt-1 block text-xs text-terminal-muted">{skill.path}</code>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => deleteSkill(skill.name)} className={btnDangerSm}>
                    Delete
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export function SkillsPage() {
  return (
    <AuthProvider>
      <SkillsPageInner />
    </AuthProvider>
  )
}
