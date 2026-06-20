import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import path from "path"

export const NIKCLI_MONOREPO_ROOT = path.resolve(
  process.env.NIKCLI_MONOREPO_ROOT ?? path.resolve(import.meta.dir, "../../.."),
)

export type IntelSection = "overview" | "packages" | "flows" | "structure" | "architecture" | "agents"

export interface MonorepoPackageIntel {
  name: string
  relPath: string
  description: string
  category: string
  runtime: string
  workspaceDeps: string[]
}

export interface NikcliIntelSnapshot {
  scannedAt: string
  rootVersion: string
  nikcliVersion: string
  monorepoRoot: string
  packageCount: number
  srcModuleCount: number
  testFileCount: number
  packages: MonorepoPackageIntel[]
  flows: { title: string; steps: string[] }[]
  structure: { title: string; lines: string[] }[]
  architecture: { title: string; lines: string[] }[]
  agents: { name: string; mode: string; tools: string }[]
}

const PACKAGE_JSON_CANDIDATES = [
  "packages/nikcli/package.json",
  "packages/sdk/js/package.json",
  "packages/plugin/package.json",
  "packages/util/package.json",
  "packages/script/package.json",
  "packages/app/package.json",
  "packages/ui/package.json",
  "packages/web/package.json",
  "packages/mobile/package.json",
  "packages/desktop/package.json",
  "packages/remote/package.json",
  "packages/companion/package.json",
  "packages/enterprise/package.json",
  "packages/cloud/package.json",
  "packages/function/package.json",
  "packages/slack/package.json",
  "packages/llm/package.json",
  "packages/inference/package.json",
  "packages/inference-dashboard/package.json",
  "packages/terminal-control/package.json",
  "packages/http-recorder/package.json",
  "packages/tui-image/package.json",
  "packages/webrenderer/package.json",
  "packages/bench-tui/package.json",
  "packages/console/app/package.json",
  "packages/console/core/package.json",
  "packages/console/function/package.json",
  "packages/console/mail/package.json",
  "packages/console/resource/package.json",
]

function readJsonSafe<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T
  } catch {
    return null
  }
}

function categorize(relPath: string, name: string): { category: string; runtime: string } {
  const p = relPath.toLowerCase()
  if (p.includes("packages/nikcli")) return { category: "core", runtime: "bun" }
  if (p.includes("sdk")) return { category: "sdk", runtime: "bun/node" }
  if (p.includes("plugin")) return { category: "extensibility", runtime: "bun" }
  if (p.includes("util") || p.includes("script") || p.includes("llm")) return { category: "library", runtime: "bun" }
  if (p.includes("app") || p.includes("/ui") || p.includes("web") || p.includes("enterprise"))
    return { category: "web-ui", runtime: "vite/cloudflare" }
  if (p.includes("mobile")) return { category: "mobile", runtime: "expo" }
  if (p.includes("desktop")) return { category: "desktop", runtime: "tauri" }
  if (p.includes("remote") || p.includes("companion")) return { category: "companion", runtime: "vite + server" }
  if (p.includes("cloud") || p.includes("function") || p.includes("slack") || p.includes("inference"))
    return { category: "cloud/edge", runtime: "cloudflare/workers" }
  if (p.includes("console")) return { category: "console", runtime: "sst/aws" }
  if (p.includes("bench-tui") || p.includes("terminal-control") || p.includes("tui-image"))
    return { category: "tui", runtime: "bun + opentui" }
  if (p.includes("containers")) return { category: "infra", runtime: "docker" }
  if (name.includes("webrenderer")) return { category: "render", runtime: "bun" }
  return { category: "other", runtime: "bun" }
}

function scanPackages(root: string): MonorepoPackageIntel[] {
  const out: MonorepoPackageIntel[] = []
  for (const rel of PACKAGE_JSON_CANDIDATES) {
    const full = path.join(root, rel)
    if (!existsSync(full)) continue
    const pkg = readJsonSafe<{
      name?: string
      description?: string
      dependencies?: Record<string, string>
    }>(full)
    if (!pkg?.name) continue
    const deps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@nikcli") || d === "nikcli-ai")
    const { category, runtime } = categorize(rel, pkg.name)
    out.push({
      name: pkg.name,
      relPath: rel.replace("/package.json", ""),
      description: (pkg.description ?? "").trim() || "—",
      category,
      runtime,
      workspaceDeps: deps,
    })
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

function countFiles(
  dir: string,
  pattern: RegExp,
  skip = new Set(["node_modules", ".git", "dist", "coverage"]),
): number {
  if (!existsSync(dir)) return 0
  let n = 0
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue
      const fp = path.join(d, ent.name)
      if (ent.isDirectory()) walk(fp)
      else if (pattern.test(ent.name)) n++
    }
  }
  walk(dir)
  return n
}

function listSrcModules(nikcliRoot: string): number {
  const src = path.join(nikcliRoot, "src")
  if (!existsSync(src)) return 0
  return readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()).length
}

function staticFlows(): NikcliIntelSnapshot["flows"] {
  return [
    {
      title: "1. Default TUI session",
      steps: [
        "nikcli → packages/nikcli/src/index.ts (yargs CLI)",
        "bootstrap project/instance → Effect runtime + Storage",
        "TUI worker (cli/cmd/tui) ↔ local or remote server via SDK + SSE",
        "User prompt → Session v2 message/parts → agent loop (session/runner)",
        "LLM stream → tool calls (tool/*) → permissions → bus events → TUI refresh",
      ],
    },
    {
      title: "2. Headless serve / web / mobile",
      steps: [
        "nikcli serve | web | companion serve → Hono server (server/server.ts)",
        "OpenAPI + @nikcli-ai/sdk clients (app, remote, mobile)",
        "Web/mobile attach: sessions, share URLs, workspace-serve sync",
        "Remote: tunnel + cloud relay (cli/remote)",
      ],
    },
    {
      title: "3. Autonomous orchestration",
      steps: [
        "goal → session/goal.ts (budget, verify, persist)",
        "mission / loop / routine → mission/*, loop/*, scheduler/* (headless)",
        "task(background) → background/run + delegation/manager",
        "Subagents (explore, planner, …) via tool/task + delegator synthesis",
      ],
    },
    {
      title: "4. Integrations",
      steps: [
        "MCP: mcp/* OAuth + tool bridge",
        "ACP: acp/* for external editors (nikcli acp)",
        "Chatbots: chatbot/* → Slack/Discord/Teams/Linear/GitHub",
        "Plugins: @nikcli-ai/plugin + nikcli plug install",
      ],
    },
  ]
}

function staticStructure(packages: MonorepoPackageIntel[]): NikcliIntelSnapshot["structure"] {
  const byCat = new Map<string, number>()
  for (const p of packages) byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1)
  const catLine = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}: ${n}`)
    .join(" · ")

  return [
    {
      title: "Workspace & tooling",
      lines: [
        "Root: bun workspaces (packages/*, console/*, sdk/js, slack, github)",
        "turbo: typecheck, build (^build), nikcli#test",
        "sst.config.ts + infra/* → console/enterprise deploy",
        "script/* publish, release, ci; homebrew-tap; nix; containers/",
      ],
    },
    {
      title: "Package categories",
      lines: [catLine, `${packages.length} workspace packages indexed`],
    },
    {
      title: "Core dependency hub",
      lines: [
        "nikcli-ai ← @nikcli-ai/sdk, plugin, script, util (workspace)",
        "TUI: @opentui/core + solid; server generates OpenAPI → SDK regen",
        "Clients: app, web, mobile, remote, companion, enterprise",
      ],
    },
  ]
}

function staticArchitecture(moduleCount: number): NikcliIntelSnapshot["architecture"] {
  return [
    {
      title: "Runtime layers (text)",
      lines: [
        "CLI/TUI → Instance (effect/*) → Server routes / Session runner",
        "Provider (LLM) + Tool registry + PermissionNext",
        "Persistence: database/* Drizzle SQLite + storage/* KV paths",
        `~${moduleCount} top-level src modules under packages/nikcli/src`,
      ],
    },
    {
      title: "Core namespaces",
      lines: [
        "session/ (v2, messages, compaction, goal), agent/, tool/",
        "project/, workspace/, worktree/, sandbox/",
        "bus/, observability/, delegation/, background/",
      ],
    },
    {
      title: "Extension points",
      lines: [
        "plugin/ + skill/ + TUI feature-plugins",
        "MCP servers, connectors/, custom agents (agent create)",
        "missions, loops, routines (scheduler)",
      ],
    },
  ]
}

function staticAgents(): NikcliIntelSnapshot["agents"] {
  return [
    { name: "build", mode: "primary", tools: "full coding toolset" },
    { name: "plan", mode: "primary", tools: "read/plan, limited writes" },
    { name: "ralph", mode: "primary", tools: "autonomous build variant" },
    { name: "explore / fast-explore", mode: "subagent", tools: "read/search" },
    {
      name: "planner / code-reviewer / debugger / test-runner",
      mode: "subagent",
      tools: "domain-focused",
    },
    {
      name: "delegator / researcher / scout",
      mode: "subagent",
      tools: "coordination & evidence",
    },
  ]
}

export function loadNikcliIntel(): NikcliIntelSnapshot {
  const rootPkg = readJsonSafe<{ version?: string }>(path.join(NIKCLI_MONOREPO_ROOT, "package.json"))
  const nikcliPkg = readJsonSafe<{ version?: string }>(path.join(NIKCLI_MONOREPO_ROOT, "packages/nikcli/package.json"))
  const packages = scanPackages(NIKCLI_MONOREPO_ROOT)
  const nikcliRoot = path.join(NIKCLI_MONOREPO_ROOT, "packages/nikcli")
  const testDir = path.join(nikcliRoot, "test")

  return {
    scannedAt: new Date().toISOString(),
    rootVersion: rootPkg?.version ?? "?",
    nikcliVersion: nikcliPkg?.version ?? "?",
    monorepoRoot: NIKCLI_MONOREPO_ROOT,
    packageCount: packages.length,
    srcModuleCount: listSrcModules(nikcliRoot),
    testFileCount: countFiles(testDir, /\.test\.ts$/),
    packages,
    flows: staticFlows(),
    structure: staticStructure(packages),
    architecture: staticArchitecture(listSrcModules(nikcliRoot)),
    agents: staticAgents(),
  }
}

export function intelSectionRows(snapshot: NikcliIntelSnapshot, section: IntelSection): string[] {
  const rows: string[] = []
  switch (section) {
    case "overview":
      rows.push(
        `nikcli monorepo v${snapshot.rootVersion} · core nikcli-ai v${snapshot.nikcliVersion}`,
        `root: ${snapshot.monorepoRoot}`,
        `packages: ${snapshot.packageCount} · src modules: ${snapshot.srcModuleCount} · tests: ${snapshot.testFileCount}`,
        `scanned: ${snapshot.scannedAt}`,
        "",
        "Surfaces: TUI · headless server · web · mobile · bots · ACP · plugins",
        "Orchestration: sessions v2 · goals · missions · loops · routines",
        "Stack: Bun · Hono · OpenTUI/Solid · Drizzle/SQLite · Effect (migration)",
      )
      break
    case "packages":
      for (const p of snapshot.packages) {
        rows.push(`[${p.category}] ${p.name}`)
        rows.push(`  ${p.relPath} · ${p.runtime}`)
        if (p.description !== "—") rows.push(`  ${p.description}`)
        if (p.workspaceDeps.length) rows.push(`  deps: ${p.workspaceDeps.join(", ")}`)
        rows.push("")
      }
      break
    case "flows":
      for (const f of snapshot.flows) {
        rows.push(f.title)
        for (const s of f.steps) rows.push(`  → ${s}`)
        rows.push("")
      }
      break
    case "structure":
      for (const block of snapshot.structure) {
        rows.push(block.title)
        for (const l of block.lines) rows.push(`  ${l}`)
        rows.push("")
      }
      break
    case "architecture":
      for (const block of snapshot.architecture) {
        rows.push(block.title)
        for (const l of block.lines) rows.push(`  ${l}`)
        rows.push("")
      }
      break
    case "agents":
      for (const a of snapshot.agents) {
        rows.push(`${a.name} (${a.mode})`)
        rows.push(`  ${a.tools}`)
      }
      break
  }
  return rows.length ? rows : ["(no data)"]
}

export const INTEL_SECTIONS: {
  key: IntelSection
  label: string
  keybind: string
}[] = [
  { key: "overview", label: "Overview", keybind: "1" },
  { key: "packages", label: "Packages", keybind: "2" },
  { key: "flows", label: "Flows", keybind: "3" },
  { key: "structure", label: "Structure", keybind: "4" },
  { key: "architecture", label: "Architecture", keybind: "5" },
  { key: "agents", label: "Agents", keybind: "6" },
]
