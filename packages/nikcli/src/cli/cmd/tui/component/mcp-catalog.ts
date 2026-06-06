import type { McpLocalConfig } from "@nikcli-ai/sdk/v2"
import { Runtime } from "@/util/runtime"

export type CatalogMcp = {
  name: string
  description: string
  config: McpLocalConfig
  requiredEnv?: string[]
}

// "__CWD__" in command arrays is replaced with process.cwd() at add-time
export const MCP_CATALOG: CatalogMcp[] = [
  {
    name: "github",
    description: "GitHub repos, PRs, issues and code search",
    config: { type: "local", command: Runtime.npx("-y", "@modelcontextprotocol/server-github") },
    requiredEnv: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
  {
    name: "brave-search",
    description: "Web and local search via Brave Search API",
    config: { type: "local", command: Runtime.npx("-y", "@modelcontextprotocol/server-brave-search") },
    requiredEnv: ["BRAVE_API_KEY"],
  },
  {
    name: "filesystem",
    description: "Read/write local files (scoped to cwd)",
    config: { type: "local", command: Runtime.npx("-y", "@modelcontextprotocol/server-filesystem", "__CWD__") },
  },
  {
    name: "memory",
    description: "Persistent key-value memory across sessions",
    config: { type: "local", command: Runtime.npx("-y", "@modelcontextprotocol/server-memory") },
  },
  {
    name: "postgres",
    description: "Read-only PostgreSQL query access",
    config: { type: "local", command: Runtime.npx("-y", "@modelcontextprotocol/server-postgres") },
    requiredEnv: ["DATABASE_URL"],
  },
  {
    name: "puppeteer",
    description: "Browser automation and web scraping",
    config: { type: "local", command: Runtime.npx("-y", "@modelcontextprotocol/server-puppeteer") },
  },
  {
    name: "sequential-thinking",
    description: "Step-by-step structured multi-step reasoning",
    config: { type: "local", command: Runtime.npx("-y", "@modelcontextprotocol/server-sequential-thinking") },
  },
  {
    name: "with-context",
    description: "Project markdown notes with templates and batch edits",
    config: { type: "local", command: Runtime.npx("-y", "with-context-mcp") },
  },
]
