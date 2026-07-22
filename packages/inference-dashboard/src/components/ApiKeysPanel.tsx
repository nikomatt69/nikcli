import { createResource, createSignal, For, Show } from "solid-js"

interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  tier: string
  last_used_at: number | null
  revoked_at: number | null
  created_at: number
}

interface IssuedKey {
  id: string
  plaintext: string
  prefix: string
  tier: string
  name: string
  createdAt: number
}

async function fetchKeys(): Promise<ApiKeyRow[]> {
  // Never runs during SSR (no origin for a relative fetch on the worker) and
  // never throws: an errored Solid resource blanks the whole island when read.
  if (typeof window === "undefined") return []
  try {
    const res = await fetch("/api/keys")
    if (!res.ok) return []
    const data = (await res.json()) as { keys?: ApiKeyRow[] }
    return data.keys ?? []
  } catch {
    return []
  }
}

function formatDate(unixSec: number | null): string {
  if (!unixSec) return "Not used"
  return new Date(unixSec * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" })
}

export default function ApiKeysPanel() {
  const [keys, { refetch }] = createResource(fetchKeys, { initialValue: [] })
  const [newName, setNewName] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  const [createdKey, setCreatedKey] = createSignal<IssuedKey | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  async function onCreate(e: SubmitEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName() || "default" }),
      })
      const data = (await res.json()) as { key?: IssuedKey; error?: string }
      if (!res.ok || !data.key) throw new Error(data.error || "Failed")
      setCreatedKey(data.key)
      setNewName("")
      await refetch()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function onRevoke(id: string) {
    if (!confirm("Revoke this key? Any client using it will start failing immediately.")) return
    await fetch(`/api/keys/${id}`, { method: "DELETE" })
    await refetch()
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div class="space-y-5">
      <Show when={createdKey()}>
        {(k) => (
          <div class="rounded-[var(--radius-card)] border border-terminal-accent/40 bg-terminal-accent/10 p-5 shadow-soft">
            <div class="flex items-center gap-2 mb-2">
              <svg class="w-4 h-4 text-terminal-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <p class="text-sm font-semibold text-terminal-text">Your new API key — copy it now</p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code class="flex-1 break-all rounded-[var(--radius-md)] border border-terminal-border bg-terminal-code px-3.5 py-2.5 font-mono text-xs text-terminal-text">
                {k().plaintext}
              </code>
              <button onClick={() => copy(k().plaintext)} class="app-button-primary text-xs">
                Copy
              </button>
              <button onClick={() => setCreatedKey(null)} class="app-button-secondary text-xs">
                Dismiss
              </button>
            </div>
          </div>
        )}
      </Show>

      <form onSubmit={onCreate} class="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div class="flex-1">
          <label class="app-label mb-1.5">Key name</label>
          <input value={newName()} onInput={(e) => setNewName(e.currentTarget.value)} class="app-input" />
        </div>
        <button type="submit" disabled={creating()} class="app-button-primary">
          {creating() ? (
            <>
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Generating…
            </>
          ) : (
            <>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Create key
            </>
          )}
        </button>
      </form>
      {error() && (
        <div class="rounded-[var(--radius-md)] border border-terminal-error/30 bg-terminal-error/10 px-4 py-3">
          <p class="text-sm text-terminal-error">{error()}</p>
        </div>
      )}

      <div class="grid gap-3 md:hidden">
        <Show
          when={!keys.loading}
          fallback={
            <div class="app-mobile-card text-center text-sm text-terminal-muted">
              <div class="flex items-center justify-center gap-2">
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Loading keys
              </div>
            </div>
          }
        >
          <Show
            when={(keys() ?? []).length > 0}
            fallback={
              <div class="app-mobile-card text-center text-sm text-terminal-muted">
                No API keys yet. Create one above.
              </div>
            }
          >
            <For each={keys()}>
              {(k) => (
                <article class={`app-mobile-card space-y-3 ${k.revoked_at ? "opacity-50" : ""}`}>
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-semibold text-terminal-text">{k.name}</p>
                      <p class="mt-1 font-mono text-xs text-terminal-muted">{k.prefix}</p>
                    </div>
                    <span
                      class={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
                        k.tier === "free"
                          ? "bg-terminal-accent/10 text-terminal-accent"
                          : k.tier === "pro"
                            ? "bg-terminal-success/10 text-terminal-success"
                            : "bg-terminal-panel text-terminal-muted"
                      }`}
                    >
                      {k.tier}
                    </span>
                  </div>
                  <div class="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p class="app-label">Created</p>
                      <p class="mt-1 text-terminal-text">{formatDate(k.created_at)}</p>
                    </div>
                    <div>
                      <p class="app-label">Last used</p>
                      <p class="mt-1 text-terminal-text">{formatDate(k.last_used_at)}</p>
                    </div>
                  </div>
                  <div class="border-t border-terminal-border/50 pt-3">
                    {k.revoked_at ? (
                      <span class="text-xs text-terminal-muted/60">Revoked</span>
                    ) : (
                      <button
                        onClick={() => onRevoke(k.id)}
                        class="text-xs font-medium text-terminal-error hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </article>
              )}
            </For>
          </Show>
        </Show>
      </div>

      <div class="app-table-wrap hidden overflow-x-auto md:block">
        <table class="w-full min-w-[720px] text-sm">
          <thead class="bg-terminal-bg/70 text-xs uppercase tracking-wider">
            <tr>
              <th class="px-4 py-3 text-left font-semibold text-terminal-muted">Name</th>
              <th class="px-4 py-3 text-left font-semibold text-terminal-muted">Key</th>
              <th class="px-4 py-3 text-left font-semibold text-terminal-muted">Tier</th>
              <th class="px-4 py-3 text-left font-semibold text-terminal-muted">Created</th>
              <th class="px-4 py-3 text-left font-semibold text-terminal-muted">Last used</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-terminal-border/50">
            <Show
              when={!keys.loading}
              fallback={
                <tr>
                  <td colspan="6" class="px-4 py-8 text-center text-terminal-muted">
                    <div class="flex items-center justify-center gap-2">
                      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        ></circle>
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Loading…
                    </div>
                  </td>
                </tr>
              }
            >
              <Show
                when={(keys() ?? []).length > 0}
                fallback={
                  <tr>
                    <td colspan="6" class="px-4 py-8 text-center text-terminal-muted">
                      No API keys yet. Create one above.
                    </td>
                  </tr>
                }
              >
                <For each={keys()}>
                  {(k) => (
                    <tr
                      class={`transition-colors duration-100 hover:bg-surface-hover ${k.revoked_at ? "opacity-50" : ""}`}
                    >
                      <td class="px-4 py-3 font-medium text-terminal-text">{k.name}</td>
                      <td class="px-4 py-3 font-mono text-xs text-terminal-muted">{k.prefix}</td>
                      <td class="px-4 py-3">
                        <span
                          class={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                            k.tier === "free"
                              ? "bg-terminal-accent/10 text-terminal-accent"
                              : k.tier === "pro"
                                ? "bg-terminal-success/10 text-terminal-success"
                                : "bg-terminal-panel text-terminal-muted"
                          }`}
                        >
                          {k.tier}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-terminal-muted">{formatDate(k.created_at)}</td>
                      <td class="px-4 py-3 text-terminal-muted">{formatDate(k.last_used_at)}</td>
                      <td class="px-4 py-3 text-right">
                        {k.revoked_at ? (
                          <span class="text-xs text-terminal-muted/60">Revoked</span>
                        ) : (
                          <button
                            onClick={() => onRevoke(k.id)}
                            class="text-xs font-medium text-terminal-error hover:underline"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </For>
              </Show>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  )
}
