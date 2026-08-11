/**
 * Missions — headless CLI command.
 *
 * Mirrors `cmd/goal.ts` + `cmd/routine.ts`:
 *   - `nikcli mission` opens the headless mission manager (list + create)
 *   - `nikcli mission new` creates a mission from a brief (-f file, --model, --agent)
 *   - `nikcli mission start <id>` orchestrates a mission
 *   - `nikcli mission pause/resume/cancel <id>` operate on the orchestrator
 *   - `nikcli mission get <id>` shows progress
 *
 * The actual work happens in `src/mission/orchestrator.ts`; this command is a
 * thin headless wrapper that boots the instance, drives a plan, then prints
 * the result.
 */

import type { Argv } from "yargs"
import path from "path"
import fs from "fs/promises"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Log } from "@/util/log"
import * as Manager from "@/mission/manager"
import * as Orchestrator from "@/mission/orchestrator"
import {
  definitionFromGenerated,
  definitionFromGeneratedText,
  progressOf,
  type MissionDefinition,
} from "@/mission/schema"

const log = Log.create({ service: "mission-cmd" })

function formatDate(ts: number) {
  return new Date(ts).toLocaleString()
}

function formatStatus(def: MissionDefinition, rt: Orchestrator.Runtime): string {
  if (rt.status === "running") {
    const f = rt.currentFeatureID ? ` · feature ${rt.currentFeatureID}` : ""
    return `running${f} (${rt.doneFeatures}/${rt.totalFeatures})`
  }
  if (rt.status === "cancelling") return "cancelling"
  if (rt.status === "paused") return "paused"
  if (rt.status === "error") return `error${rt.lastError ? `: ${truncate(rt.lastError, 32)}` : ""}`
  return def.status
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

async function readBrief(file: string | undefined, inline: string | undefined): Promise<string> {
  if (file) {
    const resolved = path.resolve(process.cwd(), file)
    return fs.readFile(resolved, "utf8")
  }
  if (inline && inline.trim()) return inline
  // Fallback to stdin if piped.
  if (!process.stdin.isTTY) {
    const text = await Bun.stdin.text()
    if (text.trim()) return text
  }
  UI.error('Mission requires a brief. Pass --brief "..." or --file <path>, or pipe via stdin.')
  process.exit(1)
}

export const MissionCommand = cmd({
  command: "mission",
  describe: "manage Missions — multi-milestone autonomous workflows",
  builder: (yargs: Argv) =>
    yargs
      .command(MissionListCommand)
      .command(MissionNewCommand)
      .command(MissionGetCommand)
      .command(MissionStartCommand)
      .command(MissionPauseCommand)
      .command(MissionResumeCommand)
      .command(MissionCancelCommand)
      .command(MissionDeleteCommand)
      .demandCommand(),
  async handler() {},
})

const MissionListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list all missions for the current project",
  builder: (yargs) =>
    yargs.option("format", {
      type: "string",
      choices: ["table", "json"] as const,
      default: "table",
      describe: "output format",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const missions = await Manager.list()
      if (args.format === "json") {
        const decorated = missions.map((m) => ({
          ...m,
          runtime: Orchestrator.getRuntime(m.id),
        }))
        console.log(JSON.stringify(decorated, null, 2))
        return
      }
      if (!missions.length) {
        console.log("No missions found. Create one with: nikcli mission new")
        return
      }
      const idW = Math.max(10, ...missions.map((m) => m.id.length))
      const nameW = Math.max(10, ...missions.map((m) => m.name.length))
      const header = `${"ID".padEnd(idW)}  ${"Name".padEnd(nameW)}  Status                Progress       Created`
      console.log(header)
      console.log("─".repeat(header.length))
      for (const m of missions) {
        const rt = Orchestrator.getRuntime(m.id)
        const prog = progressOf(m)
        const progress = `${prog.doneFeatures}/${prog.totalFeatures} feat · ${prog.doneMilestones}/${prog.totalMilestones} ms`
        console.log(
          `${m.id.padEnd(idW)}  ${m.name.padEnd(nameW)}  ${formatStatus(m, rt).padEnd(21)}  ${progress.padEnd(14)}  ${formatDate(m.createdAt)}`,
        )
      }
    })
  },
})

const MissionNewCommand = cmd({
  command: "new",
  describe: "create a new mission from a brief (or an LLM-generated plan from a description)",
  builder: (yargs) =>
    yargs
      .option("name", { type: "string", alias: "n", describe: "mission name" })
      .option("brief", {
        type: "string",
        alias: "b",
        describe: "mission brief (inline)",
      })
      .option("file", {
        type: "string",
        alias: "f",
        describe: "mission brief file path (markdown OK)",
      })
      .option("from-description", {
        type: "string",
        describe: "natural-language description that an LLM will turn into a plan",
      })
      .option("model", {
        type: "string",
        describe: "model override (providerID/modelID) for the planner",
      })
      .option("agent", {
        type: "string",
        describe: "default agent for the planner",
      })
      .option("worker-model", {
        type: "string",
        describe: "model override propagated to every worker run",
      })
      .option("start", {
        type: "boolean",
        describe: "start orchestration immediately",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let draft: MissionDefinition
      if (args.fromDescription) {
        UI.println(UI.Style.TEXT_INFO_BOLD + "▶" + UI.Style.TEXT_DIM, "Generating mission plan from description…")
        const { generateFromDescription } = await import("../../mission/generate")
        draft = await generateFromDescription(String(args.fromDescription), {
          ...(args.model ? { model: String(args.model) } : {}),
          ...(args.agent ? { agent: String(args.agent) } : {}),
        })
        // If the user passed a brief file too, prefer the user's brief.
        if (args.file || args.brief) {
          const userBrief = await readBrief(args.file, args.brief)
          draft = { ...draft, brief: userBrief.trim() }
        }
      } else {
        const brief = await readBrief(args.file, args.brief)
        if (!args.name) {
          UI.error(
            "Mission --name is required when creating from a brief (use --from-description for an LLM-authored name).",
          )
          process.exit(1)
        }
        // A single-feature, single-milestone stub keeps the file-based path
        // usable without forcing the user through plan mode for trivial cases.
        draft = definitionFromGenerated({
          name: String(args.name),
          brief: brief.trim(),
          milestones: [
            {
              name: "Main",
              features: [
                {
                  name: "Execute brief",
                  agent: args.agent ?? "ralph",
                  objective: brief.trim(),
                },
              ],
            },
          ],
        })
      }
      if (args.name) draft = { ...draft, name: String(args.name) }
      if (args.workerModel) {
        const models = {
          ...draft.models,
          worker: String(args.workerModel),
        }
        draft = { ...draft, models }
      }
      const saved = await Manager.upsert(draft)
      console.log(`Created mission ${saved.id} (${saved.name})`)
      console.log(`Brief: ${truncate(saved.brief, 80)}`)
      console.log(
        `Milestones: ${saved.milestones.length} (${saved.milestones.reduce((n, m) => n + m.features.length, 0)} features)`,
      )
      if (args.start) {
        console.log("Starting orchestration…")
        void Orchestrator.start(saved.id)
        // Tail the runtime until it leaves the running state, then print a snapshot.
        await tailUntilDone(saved.id)
      } else {
        console.log(`Run it with: nikcli mission start ${saved.id}`)
      }
    })
  },
})

async function tailUntilDone(missionID: string, timeoutMs = 10 * 60_000): Promise<void> {
  const start = Date.now()
  let lastStatus: string | undefined
  for (;;) {
    const rt = Orchestrator.getRuntime(missionID)
    const status = `${rt.status} ${rt.doneFeatures}/${rt.totalFeatures}`
    if (status !== lastStatus) {
      process.stdout.write(`  ${status}\n`)
      lastStatus = status
    }
    if (rt.status === "idle" || rt.status === "error" || rt.status === "paused") return
    if (Date.now() - start > timeoutMs) {
      process.stdout.write(`  (still running after ${Math.round(timeoutMs / 1000)}s; tailing stopped)\n`)
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

const MissionGetCommand = cmd({
  command: "get <id>",
  describe: "show details of a mission",
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        demandOption: true,
        describe: "mission ID",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"] as const,
        default: "text",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const mission = await Manager.get(String(args.id))
      if (!mission) {
        UI.error(`Mission "${args.id}" not found`)
        process.exit(1)
      }
      if (args.format === "json") {
        console.log(JSON.stringify({ ...mission, runtime: Orchestrator.getRuntime(mission.id) }, null, 2))
        return
      }
      const rt = Orchestrator.getRuntime(mission.id)
      const prog = progressOf(mission)
      console.log(`ID:        ${mission.id}`)
      console.log(`Name:      ${mission.name}`)
      console.log(`Status:    ${formatStatus(mission, rt)}`)
      console.log(`Created:   ${formatDate(mission.createdAt)}`)
      console.log(`Brief:     ${mission.brief}`)
      console.log(
        `Progress:  ${prog.doneFeatures}/${prog.totalFeatures} features · ${prog.doneMilestones}/${prog.totalMilestones} milestones`,
      )
      if (rt.currentMilestoneID)
        console.log(`Current:   milestone=${rt.currentMilestoneID} feature=${rt.currentFeatureID ?? "—"}`)
      if (mission.models && Object.keys(mission.models).length > 0) {
        console.log(`Models:    ${JSON.stringify(mission.models)}`)
      }
      console.log("")
      mission.milestones.forEach((m, mi) => {
        const tick =
          m.status === "done"
            ? "✓"
            : m.status === "running"
              ? "▶"
              : m.status === "validating"
                ? "◐"
                : m.status === "blocked"
                  ? "✗"
                  : "·"
        console.log(`${tick} ${m.name} [${m.status}] (validation: ${m.validation})`)
        for (const f of m.features) {
          const ftick =
            f.status === "done"
              ? "✓"
              : f.status === "running"
                ? "▶"
                : f.status === "skipped"
                  ? "–"
                  : f.status === "error" || f.status === "blocked"
                    ? "✗"
                    : "·"
          const dep = f.dependsOn.length > 0 ? ` (after: ${f.dependsOn.join(", ")})` : ""
          const err = f.error ? ` — ${truncate(f.error, 40)}` : ""
          console.log(`    ${ftick} ${f.id} ${f.name} [${f.status}] agent=${f.agent}${dep}${err}`)
        }
      })
    })
  },
})

const MissionStartCommand = cmd({
  command: "start <id>",
  describe: "start (or resume) orchestrating a mission",
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        demandOption: true,
        describe: "mission ID",
      })
      .option("tail", {
        type: "boolean",
        describe: "tail the runtime until the mission leaves the running state",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const mission = await Manager.get(String(args.id))
      if (!mission) {
        UI.error(`Mission "${args.id}" not found`)
        process.exit(1)
      }
      console.log(`Starting mission ${mission.id} (${mission.name})…`)
      void Orchestrator.start(mission.id)
      if (args.tail) await tailUntilDone(mission.id)
      else console.log(`Tail it with: nikcli mission get ${mission.id} (or rerun with --tail)`)
    })
  },
})

const MissionPauseCommand = cmd({
  command: "pause <id>",
  describe: "pause orchestration of a mission",
  builder: (yargs) =>
    yargs.positional("id", {
      type: "string",
      demandOption: true,
      describe: "mission ID",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const mission = await Manager.get(String(args.id))
      if (!mission) {
        UI.error(`Mission "${args.id}" not found`)
        process.exit(1)
      }
      await Orchestrator.pause(mission.id)
      console.log(`Paused: ${mission.id} (${mission.name})`)
    })
  },
})

const MissionResumeCommand = cmd({
  command: "resume <id>",
  aliases: ["start"],
  describe: "resume a paused or frozen mission",
  builder: (yargs) =>
    yargs.positional("id", {
      type: "string",
      demandOption: true,
      describe: "mission ID",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const mission = await Manager.get(String(args.id))
      if (!mission) {
        UI.error(`Mission "${args.id}" not found`)
        process.exit(1)
      }
      void Orchestrator.start(mission.id)
      console.log(`Resuming: ${mission.id} (${mission.name})`)
    })
  },
})

const MissionCancelCommand = cmd({
  command: "cancel <id>",
  describe: "cancel and freeze a mission for reassessment",
  builder: (yargs) =>
    yargs.positional("id", {
      type: "string",
      demandOption: true,
      describe: "mission ID",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const mission = await Manager.get(String(args.id))
      if (!mission) {
        UI.error(`Mission "${args.id}" not found`)
        process.exit(1)
      }
      await Orchestrator.cancel(mission.id)
      console.log(`Cancelled: ${mission.id} (${mission.name}) — edit & resume with: nikcli mission start ${mission.id}`)
    })
  },
})

const MissionDeleteCommand = cmd({
  command: "delete <id>",
  aliases: ["rm"],
  describe: "delete a mission and its execution history",
  builder: (yargs) =>
    yargs
      .positional("id", {
        type: "string",
        demandOption: true,
        describe: "mission ID",
      })
      .option("yes", {
        type: "boolean",
        alias: "y",
        describe: "skip confirmation",
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      if (!args.yes) {
        UI.error("Refusing to delete without --yes (mission deletion is destructive).")
        process.exit(1)
      }
      const removed = await Manager.remove(String(args.id))
      console.log(removed ? `Deleted mission ${args.id}` : `Mission ${args.id} not found`)
    })
  },
})

// Touch the import so eslint/tsc don't flag the schema re-export as unused.
void definitionFromGeneratedText
void log
