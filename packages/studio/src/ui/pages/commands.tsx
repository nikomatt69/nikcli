import { createResource, For, Show } from "solid-js"
import { api } from "~/api"
import { Loading } from "~/components/loading"
import { EmptyState } from "~/components/empty"

export function CommandsPage() {
  const [data] = createResource(api.commands.list)

  return (
    <div class="page">
      <div class="page-header">
        <h1>Commands</h1>
      </div>
      <p class="page-desc">Slash commands available in the nikcli prompt.</p>

      <Show when={data.loading}><Loading /></Show>
      <Show when={!data.loading}>
        <div class="card-list">
          <For each={data()?.commands ?? []}>
            {(cmd) => (
              <div class="card">
                <div class="card-header">
                  <div class="card-title">/{cmd.name}</div>
                </div>
                <Show when={cmd.description}>
                  <p class="card-desc">{cmd.description}</p>
                </Show>
                <div class="card-meta">
                  <code class="code-inline text-xs">{cmd.path}</code>
                </div>
              </div>
            )}
          </For>
          <Show when={(data()?.commands ?? []).length === 0}>
            <EmptyState title="No commands found." description="Commands are .md files in a 'commands' directory of your config." />
          </Show>
        </div>
      </Show>
    </div>
  )
}
