import { useState, useEffect } from "react"
import { AuthProvider, useAuth } from "../auth/AuthContext"
import { studioApi, type SkillSummary, type SkillDetail } from "../lib/studio-api"

const isDev = typeof import.meta !== "undefined" && (import.meta as any).env?.DEV === true

function SkillsPageInner() {
  const { token, serverUrl } = useAuth()
  const isConnected = isDev || (!!token && !!serverUrl)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editSkill, setEditSkill] = useState<SkillDetail | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [bulkImport, setBulkImport] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [newContent, setNewContent] = useState("")
  const [bulkUrls, setBulkUrls] = useState("")
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

  const openEdit = async (name: string) => {
    try {
      const skill = await studioApi.skills.get(name)
      setEditSkill(skill)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed")
    }
  }

  const saveSkill = async () => {
    if (!editSkill) return
    setBusy(true)
    try {
      await studioApi.skills.update(editSkill.name, { content: editSkill.content, description: editSkill.description })
      setEditSkill(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setBusy(false)
    }
  }

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

  const importBulk = async () => {
    const urls = bulkUrls
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean)
    if (!urls.length) return
    setBusy(true)
    try {
      await studioApi.skills.importUrls(urls)
      window.posthog?.capture("skills_bulk_imported", { count: urls.length })
      setBulkUrls("")
      setBulkImport(false)
      load()
    } catch (e) {
      window.posthog?.captureException(e)
      setError(e instanceof Error ? e.message : "Import failed")
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
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
        <div className="mb-4 text-4xl">🔒</div>
        <h3 className="text-lg font-semibold text-terminal-text">Not connected</h3>
        <p className="mt-2 text-sm text-terminal-muted">Configure server connection in Settings</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {editSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-terminal-border bg-terminal-panel">
            <div className="flex items-center justify-between border-b border-terminal-border px-6 py-4">
              <h3 className="font-semibold text-terminal-text">Edit: {editSkill.name}</h3>
              <button onClick={() => setEditSkill(null)} className="text-terminal-muted hover:text-terminal-text">
                ✕
              </button>
            </div>
            <div className="space-y-4 p-6">
              <input
                value={editSkill.description ?? ""}
                onChange={(e) => setEditSkill({ ...editSkill, description: e.target.value })}
                placeholder="Description"
                className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
              />
              <textarea
                value={editSkill.content ?? ""}
                onChange={(e) => setEditSkill({ ...editSkill, content: e.target.value })}
                rows={16}
                className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-3 font-mono text-sm text-terminal-text focus:border-terminal-accent focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-terminal-border px-6 py-4">
              <button
                onClick={() => setEditSkill(null)}
                className="rounded-xl border border-terminal-border px-4 py-2 text-sm text-terminal-muted hover:bg-terminal-border/50"
              >
                Cancel
              </button>
              <button
                onClick={saveSkill}
                disabled={busy}
                className="rounded-xl bg-terminal-accent px-6 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-terminal-muted">Create and manage reusable skill prompts</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setBulkImport(!bulkImport)
              setShowCreate(false)
            }}
            className="rounded-xl border border-terminal-border px-4 py-2 text-sm font-medium text-terminal-text transition-colors hover:bg-terminal-border/50"
          >
            Bulk Import
          </button>
          <button
            onClick={() => {
              setShowCreate(!showCreate)
              setBulkImport(false)
            }}
            className="rounded-xl bg-terminal-accent px-4 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90"
          >
            {showCreate ? "Cancel" : "+ New Skill"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-terminal-error/30 bg-terminal-error/10 px-4 py-3 text-sm text-terminal-error">
          {error}
        </div>
      )}

      {bulkImport && (
        <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6 space-y-4">
          <textarea
            value={bulkUrls}
            onChange={(e) => setBulkUrls(e.target.value)}
            rows={5}
            placeholder={"Paste raw GitHub URLs (one per line)\nhttps://raw.githubusercontent.com/.../SKILL.md"}
            className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-3 font-mono text-sm text-terminal-text focus:border-terminal-accent focus:outline-none"
          />
          <button
            onClick={importBulk}
            disabled={busy}
            className="rounded-xl bg-terminal-accent px-6 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      )}

      {showCreate && (
        <div className="rounded-2xl border border-terminal-border bg-terminal-panel p-6 space-y-4">
          <h3 className="font-semibold text-terminal-text">New Skill</h3>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Skill name"
            className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-2.5 text-terminal-text focus:border-terminal-accent focus:outline-none"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={8}
            placeholder="Skill content (Markdown)..."
            className="w-full rounded-xl border border-terminal-border bg-terminal-bg px-4 py-3 font-mono text-sm text-terminal-text focus:border-terminal-accent focus:outline-none"
          />
          <button
            onClick={createSkill}
            disabled={busy}
            className="rounded-xl bg-terminal-accent px-6 py-2 text-sm font-semibold text-white hover:bg-terminal-accent/90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create Skill"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-terminal-border border-t-terminal-accent" />
        </div>
      ) : skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border bg-terminal-panel py-16 text-center">
          <div className="mb-4 text-4xl">🧠</div>
          <h3 className="text-lg font-semibold text-terminal-text">No skills</h3>
          <p className="mt-2 text-sm text-terminal-muted">Create a skill or import from GitHub</p>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => (
            <div
              key={skill.name}
              className={`rounded-2xl border bg-terminal-panel p-5 ${skill.disabled ? "opacity-50" : "border-terminal-border"}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-terminal-text">{skill.name}</span>
                    {skill.category && (
                      <span className="rounded-full bg-terminal-border/50 px-2 py-0.5 text-xs text-terminal-muted">
                        {skill.category}
                      </span>
                    )}
                    {skill.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-terminal-border/50 px-2 py-0.5 text-xs text-terminal-muted"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  {skill.description && <p className="mt-1 text-sm text-terminal-muted">{skill.description}</p>}
                  {skill.path && <code className="mt-1 block text-xs text-terminal-muted">{skill.path}</code>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(skill.name)}
                    className="rounded-lg border border-terminal-border px-3 py-1.5 text-xs font-medium text-terminal-text hover:bg-terminal-border/50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteSkill(skill.name)}
                    className="rounded-lg border border-terminal-error/30 px-3 py-1.5 text-xs font-medium text-terminal-error hover:bg-terminal-error/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
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
