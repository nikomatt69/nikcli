import { createSignal, createResource, For, Show } from "solid-js"
import { api } from "~/api"
import type { SkillDetail } from "~/types"
import { Loading } from "~/components/loading"
import { EmptyState } from "~/components/empty"
import { Modal } from "~/components/modal"

export function SkillsPage() {
  const [data, { refetch }] = createResource(api.skills.list)
  const [editSkill, setEditSkill] = createSignal<SkillDetail | null>(null)
  const [showCreate, setShowCreate] = createSignal(false)
  const [bulkImport, setBulkImport] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [newDesc, setNewDesc] = createSignal("")
  const [newContent, setNewContent] = createSignal("")
  const [bulkUrls, setBulkUrls] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const openEdit = async (name: string) => {
    const skill = await api.skills.get(name)
    setEditSkill(skill)
  }

  const saveSkill = async () => {
    const skill = editSkill()
    if (!skill) return
    setBusy(true)
    try {
      await api.skills.update(skill.name, { content: skill.content, description: skill.description, category: skill.category, tags: skill.tags })
      setEditSkill(null)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  const createSkill = async () => {
    if (!newName().trim()) return
    setBusy(true)
    try {
      await api.skills.create(newName().trim(), newDesc(), newContent())
      setNewName("")
      setNewDesc("")
      setNewContent("")
      setShowCreate(false)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  const importBulk = async () => {
    const urls = bulkUrls().split("\n").map((u) => u.trim()).filter(Boolean)
    if (!urls.length) return
    setBusy(true)
    try {
      await api.skills.importUrls(urls)
      setBulkUrls("")
      setBulkImport(false)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  const deleteSkill = async (name: string) => {
    await api.skills.delete(name)
    refetch()
  }

  return (
    <div class="page">
      <div class="page-header">
        <h1>Skills</h1>
        <div class="btn-group">
          <button class="btn btn-secondary" onClick={() => setBulkImport(!bulkImport())}>Bulk Import</button>
          <button class="btn btn-primary" onClick={() => setShowCreate(!showCreate())}>
            {showCreate() ? "Cancel" : "+ New Skill"}
          </button>
        </div>
      </div>

      <Show when={bulkImport()}>
        <div class="add-form">
          <textarea
            class="textarea"
            rows={5}
            placeholder={"Paste raw GitHub URLs (one per line)\nhttps://raw.githubusercontent.com/.../SKILL.md"}
            value={bulkUrls()}
            onInput={(e) => setBulkUrls(e.currentTarget.value)}
          />
          <button class="btn btn-primary" disabled={busy()} onClick={importBulk}>
            {busy() ? "Importing..." : "Import"}
          </button>
        </div>
      </Show>

      <Show when={showCreate()}>
        <div class="add-form">
          <input class="input" placeholder="Skill name" value={newName()} onInput={(e) => setNewName(e.currentTarget.value)} />
          <input class="input" placeholder="Description" value={newDesc()} onInput={(e) => setNewDesc(e.currentTarget.value)} />
          <textarea class="textarea" rows={8} placeholder="Skill content (Markdown)..." value={newContent()} onInput={(e) => setNewContent(e.currentTarget.value)} />
          <button class="btn btn-primary" disabled={busy()} onClick={createSkill}>
            {busy() ? "Creating..." : "Create Skill"}
          </button>
        </div>
      </Show>

      <Show when={editSkill()}>
        <Modal
          title={`Edit Skill: ${editSkill()!.name}`}
          onClose={() => setEditSkill(null)}
          wide
          footer={
            <button class="btn btn-primary" disabled={busy()} onClick={saveSkill}>
              {busy() ? "Saving..." : "Save"}
            </button>
          }
        >
          <input
            class="input"
            placeholder="Description"
            value={editSkill()!.description ?? ""}
            onInput={(e) => setEditSkill({ ...editSkill()!, description: e.currentTarget.value })}
          />
          <textarea
            class="textarea mono"
            rows={20}
            value={editSkill()!.content ?? ""}
            onInput={(e) => setEditSkill({ ...editSkill()!, content: e.currentTarget.value })}
          />
        </Modal>
      </Show>

      <Show when={data.loading}>
        <Loading />
      </Show>
      <Show when={!data.loading}>
        <div class="card-list">
          <For each={data()?.skills ?? []}>
            {(skill) => (
              <div class={`card${skill.disabled ? " card-disabled" : ""}`}>
                <div class="card-header">
                  <div class="card-title">
                    {skill.name}
                    <Show when={skill.category}><span class="tag">{skill.category}</span></Show>
                    <For each={skill.tags ?? []}>{(tag) => <span class="tag">{tag}</span>}</For>
                  </div>
                  <div class="card-actions">
                    <button class="btn btn-ghost btn-sm" onClick={() => openEdit(skill.name)}>Edit</button>
                    <button class="btn btn-ghost btn-danger btn-sm" onClick={() => deleteSkill(skill.name)}>Delete</button>
                  </div>
                </div>
                <Show when={skill.description}>
                  <p class="card-desc">{skill.description}</p>
                </Show>
                <div class="card-meta">
                  <code class="code-inline text-xs">{skill.path}</code>
                </div>
              </div>
            )}
          </For>
          <Show when={(data()?.skills ?? []).length === 0}>
            <EmptyState title="No skills found." description="Create a skill or import from GitHub." />
          </Show>
        </div>
      </Show>
    </div>
  )
}
