export type CatalogPlugin = {
  pkg: string
  name: string
  description: string
}

export const PLUGIN_CATALOG: CatalogPlugin[] = [
  { pkg: "nikcli-notify",            name: "Notify",            description: "OS notifications when tasks complete" },
  { pkg: "nikcli-background-agents", name: "Background Agents", description: "Claude Code-style background agents with async delegation" },
  { pkg: "nikcli-agent-memory",      name: "Agent Memory",      description: "Persistent self-editable memory blocks (Letta-inspired)" },
  { pkg: "nikcli-smart-title",       name: "Smart Title",       description: "Auto-generates meaningful session titles with AI" },
  { pkg: "nikcli-quota",             name: "Quota",             description: "Track quota and token usage across providers" },
  { pkg: "nikcli-worktree",          name: "Worktree",          description: "Zero-friction git worktrees with auto-spawned terminals" },
  { pkg: "nikcli-synced",            name: "Synced",            description: "Sync global nikcli config across machines" },
  { pkg: "nikcli-direnv",            name: "Direnv",            description: "Auto-load direnv env vars at session start (Nix-friendly)" },
  { pkg: "nikcli-handoff",           name: "Handoff",           description: "Creates focused handoff prompts for new sessions" },
  { pkg: "nikcli-snip",              name: "Snip",              description: "Reduce LLM token consumption by 60-90% via shell command prefix" },
]
