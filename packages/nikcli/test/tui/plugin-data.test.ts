import { describe, expect, it } from "bun:test"
import type {
  Agent,
  Command,
  ConnectorStatus,
  McpResource,
  McpStatus,
  Model,
  PermissionRequest,
  Provider,
  Pty,
  QuestionRequest,
  Session,
  SessionEntry,
} from "@nikcli-ai/sdk/v2"
import { createStore } from "solid-js/store"
import { createV2Data } from "@/cli/cmd/tui/plugin/data"

function fixture() {
  const root = {
    id: "root",
    projectID: "project",
    directory: "/repo",
    title: "Root",
    slug: "root",
    version: "1",
    permission: [{ permission: "read", pattern: "*", action: "allow" }],
    time: { created: 1, updated: 2 },
  } as Session
  const child = {
    ...root,
    id: "child",
    slug: "child",
    title: "Child",
    parentID: "root",
    time: { created: 2, updated: 3 },
  } as Session
  const model = {
    id: "model",
    providerID: "provider",
    name: "Model",
  } as Model
  const provider = {
    id: "provider",
    name: "Provider",
    source: "config",
    env: [],
    options: {},
    models: { model },
  } as Provider
  const permission = { id: "permission", sessionID: "root" } as PermissionRequest
  const form = { id: "form", sessionID: "root", questions: [] } as QuestionRequest
  const shell = { id: "shell", title: "Shell", status: "running" } as Pty
  const agent = { name: "agent", mode: "primary" } as Agent
  const command = { name: "command", template: "hello", hints: [] } as Command
  const resource = { name: "resource", uri: "mcp://resource", client: "server" } as McpResource
  const connector = { status: "connected" } as ConnectorStatus
  const mcp = { status: "connected" } as McpStatus
  const pending = { id: "pending", sessionID: "root", type: "user", timestamp: 1, text: "hello" } as SessionEntry
  const messages = {
    root: [{ id: "root-message", role: "assistant", cost: 1 }],
    child: [{ id: "child-message", role: "assistant", cost: 2 }],
  }

  const [store, setStore] = createStore({
    path: { home: "/home", state: "/state", config: "/config", worktree: "/repo", directory: "/repo" },
    session: [root, child],
    message: messages,
    part: { "root-message": [{ id: "part" }], "child-message": [] },
    permission: { root: [permission] },
    question: { root: [form] },
    agent: [agent],
    command: [command],
    connectors: { connector },
    mcp: { server: mcp },
    mcp_resource: { resource },
    provider: [provider],
    config: { reference: { docs: { type: "local", path: "/docs" } } },
  })

  const response = <T>(data: T) => Promise.resolve({ data })
  const client = {
    session: {
      list: () => response([root, child]),
      get: () => response(root),
      messages: () =>
        response([
          {
            info: messages.root[0],
            parts: [{ id: "part" }],
          },
        ]),
      v2: { state: () => response({ entries: [pending], pending: [pending] }) },
    },
    permission: { list: () => response([permission]) },
    question: { list: () => response([form]) },
    pty: { list: () => response([shell]) },
    path: { get: () => response(store.path) },
    app: {
      agents: () => response([agent]),
      skills: () => response([{ name: "skill", description: "Skill", location: "/skill" }]),
    },
    command: { list: () => response([command]) },
    connectors: { status: () => response({ connector }) },
    mcp: { status: () => response({ server: mcp }) },
    experimental: { resource: { list: () => response({ resource }) } },
    config: {
      providers: () => response({ providers: [provider], default: {} }),
      get: () => response(store.config),
    },
  }
  const sync = {
    data: store,
    set: setStore,
    session: {
      get: (id: string) => store.session.find((session) => session.id === id),
      status: (id: string) => (id === "child" ? "working" : "idle"),
    },
  }
  const sdk = {
    client,
    directory: "/repo",
    event: { on: () => () => {} },
    onEnvelope: () => () => {},
  }
  const route = { data: { type: "home", workspaceID: "workspace" } }
  return { data: createV2Data({ sdk, sync, route } as never), root, child }
}

describe("v2 tui plugin data", () => {
  it("implements the complete reactive context contract", async () => {
    const { data } = fixture()

    expect(data.location.default()).toEqual({ directory: "/repo", workspaceID: "workspace" })
    expect(data.session.list().map((session) => session.id)).toEqual(["child", "root"])
    expect(data.session.get("root")?.id).toBe("root")
    expect(data.session.root("child")).toBe("root")
    expect(data.session.family("child").sort()).toEqual(["child", "root"])
    expect(data.session.cost("root")).toBe(3)
    expect(data.session.cost("child")).toBe(2)
    expect(data.session.status("root")).toBe("idle")
    expect(data.session.status("child")).toBe("running")

    await Promise.all([
      data.session.pending.refresh("root"),
      data.session.refresh("root"),
      data.session.message.refresh("root"),
      data.session.permission.refresh("root"),
      data.session.form.refresh("root"),
      data.project.permission.refresh("project"),
      data.shell.refresh(),
      data.location.refresh(),
      data.location.agent.refresh(),
      data.location.command.refresh(),
      data.location.integration.refresh(),
      data.location.mcp.server.refresh(),
      data.location.mcp.resource.refresh(),
      data.location.model.refresh(),
      data.location.provider.refresh(),
      data.location.reference.refresh(),
      data.location.skill.refresh(),
    ])

    expect(data.session.pending.list("root")[0]?.id).toBe("pending")
    expect(data.session.message.get("root", "root-message")?.parts[0]?.id).toBe("part")
    expect(data.session.permission.list("root")?.[0]?.id).toBe("permission")
    expect(data.session.form.list("root")?.[0]?.id).toBe("form")
    expect(data.project.permission.list("project")?.[0]?.permission).toBe("read")
    expect(data.shell.get("shell")?.id).toBe("shell")
    expect(data.location.agent.list()?.[0]?.name).toBe("agent")
    expect(data.location.command.list()?.[0]?.name).toBe("command")
    expect(data.location.integration.list()?.[0]?.name).toBe("connector")
    expect(data.location.mcp.server.list()?.[0]?.name).toBe("server")
    expect(data.location.mcp.resource.list()?.[0]?.name).toBe("resource")
    expect(data.location.model.list()?.[0]?.id).toBe("model")
    expect(data.location.provider.list()?.[0]?.id).toBe("provider")
    expect(data.location.reference.list()?.[0]?.name).toBe("docs")
    expect(data.location.skill.list()?.[0]?.name).toBe("skill")
  })
})
