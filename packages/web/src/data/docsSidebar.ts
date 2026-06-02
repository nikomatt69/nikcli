export type DocsNavGroup = {
  title: string
  items: Array<{ title: string; href: string }>
}

export const docsSidebar: DocsNavGroup[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Overview", href: "/docs" },
      { title: "Architecture", href: "/docs/architecture" },
      { title: "CLI Reference", href: "/docs/cli" },
    ],
  },
  {
    title: "Core",
    items: [
      { title: "Configuration", href: "/docs/configuration" },
      { title: "Agents", href: "/docs/agents" },
      { title: "Tools", href: "/docs/tools" },
      { title: "Providers", href: "/docs/providers" },
      { title: "Connectors", href: "/docs/connectors" },
      { title: "Routines", href: "/docs/routines" },
      { title: "Localization", href: "/docs/localization" },
      { title: "Sessions", href: "/docs/sessions" },
      { title: "Permissions", href: "/docs/permissions" },
      { title: "Plugins & Skills", href: "/docs/plugins" },
    ],
  },
  {
    title: "Systems",
    items: [
      { title: "Server & API", href: "/docs/server-api" },
      { title: "Web App & Studio", href: "/docs/web-app" },
      { title: "Mobile", href: "/docs/mobile" },
      { title: "MCP", href: "/docs/mcp" },
      { title: "LSP", href: "/docs/lsp" },
      { title: "Storage", href: "/docs/storage" },
      { title: "TUI", href: "/docs/tui" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "Packages & Suite", href: "/docs/packages" },
      { title: "Source Map", href: "/docs/source-map" },
      { title: "CLI Debug", href: "/docs/cli-debug" },
    ],
  },
]
