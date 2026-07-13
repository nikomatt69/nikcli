import { useCallback, useEffect, useState } from "react"
import {
  formatRelativeTime,
  getErrorMessage,
  type MobileMemorySearchHit,
  type MobilePromptHistoryEntry,
  type MobilePromptStashEntry,
  WebNikcliClient,
} from "@/app/api"
import { Banner, Button, Chip, EmptyState, Field, Spinner, Surface, TextAreaField } from "@/app/ui"

function copyToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(text)
  }
}

export function MemoryScreen(props: { client: WebNikcliClient | null; navigate(path: string): void }) {
  const { client } = props
  const [history, setHistory] = useState<MobilePromptHistoryEntry[]>([])
  const [stash, setStash] = useState<MobilePromptStashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<MobileMemorySearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  const [stashDraft, setStashDraft] = useState("")
  const [stashBusy, setStashBusy] = useState(false)
  const [deletingStash, setDeletingStash] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setMessage(null)
      const [historyResult, stashResult] = await Promise.all([
        client.memoryHistory().catch(() => []),
        client.listStash().catch(() => []),
      ])
      setHistory(historyResult)
      setStash(stashResult)
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!client) return
    const term = query.trim()
    if (!term) {
      setHits([])
      setSearched(false)
      return
    }
    const timeout = setTimeout(async () => {
      try {
        setSearching(true)
        setHits(await client.memorySearch(term))
        setSearched(true)
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(timeout)
  }, [client, query])

  const createStash = useCallback(async () => {
    if (!client || !stashDraft.trim()) {
      setMessage("Write the prompt you want to stash")
      return
    }
    try {
      setStashBusy(true)
      setMessage(null)
      await client.createStash(stashDraft.trim())
      setStashDraft("")
      setNotice("Prompt stashed")
      await load()
    } catch (error) {
      setMessage(getErrorMessage(error))
    } finally {
      setStashBusy(false)
    }
  }, [client, load, stashDraft])

  const removeStash = useCallback(
    async (id: string) => {
      if (!client) return
      try {
        setDeletingStash(id)
        await client.deleteStash(id)
        await load()
      } catch (error) {
        setMessage(getErrorMessage(error))
      } finally {
        setDeletingStash(null)
      }
    },
    [client, load],
  )

  return (
    <div className="space-y-6">
      <Surface
        eyebrow="Memory"
        title="Prompt history, search, and stash"
        description="The same memory surface as the mobile app: search across past transcripts, reuse prompt history, and keep a stash of prompts ready to fire."
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Chip label={`${history.length} history entries`} tone="accent" />
          <Chip label={`${stash.length} stashed prompts`} tone="neutral" />
        </div>
      </Surface>

      {message ? <Banner>{message}</Banner> : null}
      {notice ? <Banner tone="good">{notice}</Banner> : null}

      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        <div className="space-y-6">
          <Surface
            eyebrow="Search"
            title="Search past conversations"
            description="Full-text search across every message stored on the connected host."
          >
            <Field
              label="Search query"
              value={query}
              onChange={setQuery}
              placeholder="Search messages, prompts, or answers"
            />
            <div className="mt-4">
              {searching ? (
                <Spinner label="Searching transcripts" />
              ) : hits.length ? (
                <div className="space-y-2">
                  {hits.map((hit) => (
                    <div key={hit.id} className="rounded-2xl border border-terminal-border bg-terminal-code px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold text-terminal-text">
                            {hit.sessionTitle || "Untitled session"}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-terminal-muted">{hit.preview}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip label={hit.role} tone={hit.role === "user" ? "accent" : "neutral"} caps />
                          <Chip label={formatRelativeTime(hit.createdAt)} tone="neutral" />
                          <Button variant="ghost" onClick={() => props.navigate(`/app/sessions/${hit.sessionID}`)}>
                            Open
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : searched ? (
                <div className="text-sm text-terminal-muted">No matches for this query.</div>
              ) : (
                <div className="text-sm text-terminal-muted">Type to search across stored transcripts.</div>
              )}
            </div>
          </Surface>

          <Surface
            eyebrow="History"
            title="Recent prompts"
            description="Prompts you've sent recently on this host, newest first."
          >
            {loading ? (
              <Spinner label="Loading history" />
            ) : history.length === 0 ? (
              <EmptyState title="No history yet" description="Prompts sent from any client will appear here." />
            ) : (
              <div className="space-y-2">
                {history.slice(0, 30).map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-terminal-border bg-terminal-code px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm text-terminal-text">{entry.input}</div>
                        {entry.mode === "shell" ? (
                          <div className="mt-1">
                            <Chip label="shell" tone="warn" caps />
                          </div>
                        ) : null}
                      </div>
                      <Button variant="ghost" onClick={() => copyToClipboard(entry.input)}>
                        Copy
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Surface>
        </div>

        <div className="space-y-6">
          <Surface
            eyebrow="Stash"
            title="Prompt stash"
            description="Save prompts you want to keep at hand; they sync with the mobile composer stash."
          >
            <div className="space-y-4">
              <TextAreaField
                label="New stash entry"
                value={stashDraft}
                onChange={setStashDraft}
                placeholder="A prompt worth keeping..."
              />
              <Button busy={stashBusy} onClick={() => void createStash()}>
                Stash prompt
              </Button>
            </div>
            <div className="mt-5">
              {stash.length === 0 ? (
                <div className="text-sm text-terminal-muted">Nothing stashed yet.</div>
              ) : (
                <div className="space-y-2">
                  {stash.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-2xl border border-terminal-border bg-terminal-code px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-3 text-sm text-terminal-text">{entry.input}</div>
                          <div className="mt-1 text-xs text-terminal-muted">
                            Stashed {formatRelativeTime(entry.timestamp)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="ghost" onClick={() => copyToClipboard(entry.input)}>
                            Copy
                          </Button>
                          <Button
                            variant="danger"
                            busy={deletingStash === entry.id}
                            onClick={() => void removeStash(entry.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  )
}
