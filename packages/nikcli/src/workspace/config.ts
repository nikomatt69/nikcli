import { Schema } from "effect"
import { zod } from "@/util/effect-zod"

const WorktreeConfig = Schema.Struct({
  directory: Schema.String,
  type: Schema.Literal("worktree"),
  name: Schema.optional(Schema.String),
  strategy: Schema.optional(Schema.Literals(["git", "cow"])),
  eventLimit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
})

const ContainerConfig = Schema.Struct({
  directory: Schema.String,
  type: Schema.Literal("container"),
  runtime: Schema.Literals(["docker", "podman"]),
  image: Schema.String,
  containerName: Schema.String,
  port: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  serverUrl: Schema.String,
  eventLimit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
})

// In-place branch workspace: no separate directory — the project's primary
// checkout is switched to `branch` on restore, so external tools (VS Code,
// terminals) follow the workspace switch. `branch` is optional at create
// time; the adaptor fills it in the config it returns.
const BranchConfig = Schema.Struct({
  directory: Schema.String,
  type: Schema.Literal("branch"),
  branch: Schema.optional(Schema.String),
  eventLimit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
})

export const ConfigSchema = Schema.Union([WorktreeConfig, ContainerConfig, BranchConfig])
export const Config = zod(ConfigSchema)
export type Config = Schema.Schema.Type<typeof ConfigSchema>
