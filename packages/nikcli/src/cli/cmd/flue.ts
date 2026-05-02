import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import path from "path"
import { Instance } from "../../project/instance"

async function flueInstalled(): Promise<boolean> {
  const proc = Bun.spawn(["which", "flue"], { stdout: "pipe", stderr: "pipe" })
  const code = await proc.exited
  return code === 0
}

async function requireFlue() {
  if (!(await flueInstalled())) {
    UI.error("Flue CLI not found. Install it with: npm install -g @flue/cli")
    process.exit(1)
  }
}

export const FlueCommand = cmd({
  command: "flue",
  describe: "manage Flue sandbox agents",
  builder: (yargs: any) =>
    yargs
      .command(FlueInitCommand)
      .command(FlueRunCommand)
      .command(FlueDevCommand)
      .command(FlueBuildCommand)
      .demandCommand(),
  async handler() {},
})

export const FlueInitCommand = cmd({
  command: "init [directory]",
  describe: "initialize a Flue workspace in the current project",
  builder: (yargs: any) =>
    yargs.positional("directory", {
      type: "string",
      describe: "workspace directory (defaults to .flue)",
      default: ".flue",
    }),
  async handler(args: any) {
    const worktree = Instance.worktree
    const workspaceDir = path.resolve(worktree, args.directory ?? ".flue")
    const agentsDir = path.join(workspaceDir, "agents")
    const rolesDir = path.join(workspaceDir, "roles")
    const skillsDir = path.join(workspaceDir, "skills")

    prompts.intro(UI.Style.TEXT_INFO_BOLD + "Flue Workspace Init" + UI.Style.TEXT_NORMAL)

    const s = prompts.spinner()
    s.start("Creating workspace directories")

    for (const dir of [rolesDir, skillsDir]) {
      await Bun.write(path.join(dir, ".gitkeep"), "")
    }

    s.stop("Workspace directories created")

    const exampleAgent = `import type { FlueContext } from '@flue/sdk/client'

export const triggers = { webhook: true }

export default async function ({ init, payload }: FlueContext) {
  const agent = await init({ model: 'anthropic/claude-sonnet-4-6' })
  const session = await agent.session()
  return await session.prompt(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  )
}
`
    const exampleAgentPath = path.join(agentsDir, "example.ts")
    const exists = await Bun.file(exampleAgentPath).exists()
    if (!exists) {
      await Bun.write(exampleAgentPath, exampleAgent)
      prompts.note(
        `Created example agent at ${path.relative(worktree, exampleAgentPath)}`,
        "Example agent",
      )
    }

    prompts.outro(
      UI.Style.TEXT_SUCCESS_BOLD +
        "Done!" +
        UI.Style.TEXT_NORMAL +
        " Run " +
        UI.Style.TEXT_DIM_BOLD +
        "nikcli flue dev" +
        UI.Style.TEXT_NORMAL +
        " to start the dev server.",
    )
  },
})

export const FlueRunCommand = cmd({
  command: "run <agent>",
  describe: "run a Flue agent once (production-style)",
  builder: (yargs: any) =>
    yargs
      .positional("agent", {
        type: "string",
        describe: "agent name to run",
        demandOption: true,
      })
      .option("id", {
        type: "string",
        describe: "session ID",
      })
      .option("payload", {
        type: "string",
        describe: "JSON payload to pass to the agent",
      })
      .option("target", {
        type: "string",
        choices: ["node", "cloudflare"],
        describe: "build target",
        default: "node",
      })
      .option("workspace", {
        type: "string",
        describe: "path to Flue workspace directory",
      }),
  async handler(args: any) {
    await requireFlue()

    const id = args.id ?? `run-${Date.now()}`
    const argv: string[] = [
      "flue",
      "run",
      args.agent,
      "--target",
      args.target ?? "node",
      "--id",
      id,
    ]

    if (args.payload) argv.push("--payload", args.payload)
    if (args.workspace) argv.push("--workspace", args.workspace)

    UI.println(
      UI.Style.TEXT_DIM_BOLD + "Running:" + UI.Style.TEXT_NORMAL + " " + argv.slice(1).join(" "),
    )

    const proc = Bun.spawn(argv, {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })

    const code = await proc.exited
    process.exit(code)
  },
})

export const FlueDevCommand = cmd({
  command: "dev",
  describe: "start the Flue dev server with hot-reloading",
  builder: (yargs: any) =>
    yargs
      .option("target", {
        type: "string",
        choices: ["node", "cloudflare"],
        describe: "build target",
        default: "node",
      })
      .option("port", {
        type: "number",
        describe: "port to listen on",
        default: 3583,
      })
      .option("workspace", {
        type: "string",
        describe: "path to Flue workspace directory",
      })
      .option("env", {
        type: "string",
        describe: "path to .env file",
      }),
  async handler(args: any) {
    await requireFlue()

    const argv: string[] = [
      "flue",
      "dev",
      "--target",
      args.target ?? "node",
      "--port",
      String(args.port ?? 3583),
    ]

    if (args.workspace) argv.push("--workspace", args.workspace)
    if (args.env) argv.push("--env", args.env)

    UI.println(
      UI.Style.TEXT_DIM_BOLD + "Starting:" + UI.Style.TEXT_NORMAL + " " + argv.slice(1).join(" "),
    )

    const proc = Bun.spawn(argv, {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })

    const code = await proc.exited
    process.exit(code)
  },
})

export const FlueBuildCommand = cmd({
  command: "build",
  describe: "build a deployable Flue artifact",
  builder: (yargs: any) =>
    yargs
      .option("target", {
        type: "string",
        choices: ["node", "cloudflare"],
        describe: "build target",
        default: "node",
      })
      .option("output", {
        type: "string",
        describe: "output directory",
        default: "dist",
      })
      .option("workspace", {
        type: "string",
        describe: "path to Flue workspace directory",
      }),
  async handler(args: any) {
    await requireFlue()

    const argv: string[] = [
      "flue",
      "build",
      "--target",
      args.target ?? "node",
      "--output",
      args.output ?? "dist",
    ]

    if (args.workspace) argv.push("--workspace", args.workspace)

    UI.println(
      UI.Style.TEXT_DIM_BOLD + "Building:" + UI.Style.TEXT_NORMAL + " " + argv.slice(1).join(" "),
    )

    const proc = Bun.spawn(argv, {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })

    const code = await proc.exited
    process.exit(code)
  },
})
