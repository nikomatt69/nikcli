import z from "zod"

export const Config = z.discriminatedUnion("type", [
  z.object({
    directory: z.string(),
    type: z.literal("worktree"),
  }),
  z.object({
    directory: z.string(),
    type: z.literal("container"),
    runtime: z.enum(["docker", "podman"]),
    image: z.string(),
    containerName: z.string(),
    port: z.number().int().positive(),
    serverUrl: z.string().url(),
  }),
])

export type Config = z.infer<typeof Config>
