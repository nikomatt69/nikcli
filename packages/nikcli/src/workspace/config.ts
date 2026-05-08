import { Schema } from "effect"
import { zod } from "@/util/effect-zod"

const WorktreeConfig = Schema.Struct({
  directory: Schema.String,
  type: Schema.Literal("worktree"),
  eventLimit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
})

const ContainerConfig = Schema.Struct({
  directory: Schema.String,
  type: Schema.Literal("container"),
  runtime: Schema.Literal("docker", "podman"),
  image: Schema.String,
  containerName: Schema.String,
  port: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
  serverUrl: Schema.String,
  eventLimit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))),
})

export const ConfigSchema = Schema.Union(WorktreeConfig, ContainerConfig)
export const Config = zod(ConfigSchema)
export type Config = Schema.Schema.Type<typeof ConfigSchema>
