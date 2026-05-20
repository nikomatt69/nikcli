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
  const res = await fetch("/api/keys")
  if (!res.ok) throw new Error("Failed to load keys")
  const data = (await res.json()) as { keys: ApiKeyRow[] }
  return data.keys
}

function formatDate(unixSec: number | null): string {
  if (!unixSec) return "—"
  return new Date(unixSec * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" })
}

export default function ApiKeysPanel() {
  const [keys, { refetch }] = createResource(fetchKeys)
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
          <div class="rounded-xl border border-terminal-accent/40 bg-terminal-accent/10 p-5 shadow-soft">
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
            <div class="flex items-center gap-2">
              <code class="flex-1 break-all rounded-lg border border-terminal-border bg-terminal-code px-3.5 py-2.5 font-mono text-xs text-terminal-text">
                {k().plaintext}
              </code>
              <button
                onClick={() => copy(k().plaintext)}
                class="rounded-lg bg-terminal-accent px-4 py-2.5 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              >
                Copy
              </button>
              <button
                onClick={() => setCreatedKey(null)}
                class="rounded-lg border border-terminal-border bg-terminal-panel px-3 py-2 text-xs text-terminal-muted transition-all hover:bg-surface-hover"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </Show>

      <form onSubmit={onCreate} class="flex items-end gap-3">
        <div class="flex-1">
          <label class="block text-xs font-medium uppercase tracking-wider text-terminal-muted mb-1.5">Key name</label>
          <input
            placeholder="production-api"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            class="w-full rounded-lg border border-terminal-border bg-terminal-panel px-3.5 py-2.5 text-sm text-terminal-text outline-none transition-all duration-150 focus:border-terminal-accent focus:ring-2 focus:ring-terminal-accent/20 placeholder:text-terminal-muted/50"
          />
        </div>
        <button
          type="submit"
          disabled={creating()}
          class="rounded-lg bg-terminal-accent px-5 py-2.5 text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
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
        <div class="rounded-lg border border-terminal-error/30 bg-terminal-error/10 px-4 py-3">
          <p class="text-sm text-terminal-error">{error()}</p>
        </div>
      )}

      <div class="overflow-hidden rounded-xl border border-terminal-border">
        <table class="w-full text-sm">
          <thead class="bg-terminal-panel text-xs uppercase tracking-wider">
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
                      <td class="px-4 py-3 font-mono text-xs text-terminal-muted">{k.prefix}…</td>
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
