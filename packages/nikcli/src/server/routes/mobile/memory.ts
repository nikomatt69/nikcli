import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { PromptStashStore } from "@/prompt/stash-store"
import { errors } from "../../error"
import {
  MobilePromptHistoryEntry,
  MobilePromptStashEntry,
  MobilePromptStashCreateInput,
  MobileMemorySearchHit,
  listPromptHistory,
  listPromptStash,
  searchPromptMemories,
} from "./helpers"

export const MemoryRoutes = () =>
  new Hono()
    .get(
      "/memory/history",
      describeRoute({
        summary: "List prompt history for mobile",
        description: "Return recent prompt history stored on the Nikcli host.",
        operationId: "mobile.memory.history",
        responses: {
          200: {
            description: "Prompt history",
            content: { "application/json": { schema: resolver(MobilePromptHistoryEntry.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await listPromptHistory())
      },
    )
    .get(
      "/memory/search",
      describeRoute({
        summary: "Search prompt memories for mobile",
        description: "Search across stored session messages for memory-like prompt context from mobile.",
        operationId: "mobile.memory.search",
        responses: {
          200: {
            description: "Memory search hits",
            content: { "application/json": { schema: resolver(MobileMemorySearchHit.array()) } },
          },
        },
      }),
      validator("query", z.object({ query: z.string().trim().min(1) })),
      async (c) => {
        const query = c.req.valid("query").query
        return c.json(await searchPromptMemories(query))
      },
    )
    .get(
      "/memory/stash",
      describeRoute({
        summary: "List prompt stash for mobile",
        description: "Return reusable prompt snippets stored on the Nikcli host.",
        operationId: "mobile.memory.stash.list",
        responses: {
          200: {
            description: "Prompt stash",
            content: { "application/json": { schema: resolver(MobilePromptStashEntry.array()) } },
          },
        },
      }),
      async (c) => {
        return c.json(await listPromptStash())
      },
    )
    .post(
      "/memory/stash",
      describeRoute({
        summary: "Create prompt stash entry",
        description: "Save a reusable prompt snippet on the Nikcli host.",
        operationId: "mobile.memory.stash.create",
        responses: {
          200: {
            description: "Created prompt stash entry",
            content: { "application/json": { schema: resolver(MobilePromptStashEntry) } },
          },
          ...errors(400),
        },
      }),
      validator("json", MobilePromptStashCreateInput),
      async (c) => {
        const body = c.req.valid("json")
        const [entry] = (
          await PromptStashStore.push({
            input: body.input.trim(),
            parts: [] as any,
          })
        ).slice(-1)
        return c.json({
          id: entry.id,
          input: entry.input,
          timestamp: entry.timestamp,
          partsCount: 0,
        })
      },
    )
    .delete(
      "/memory/stash/:id",
      describeRoute({
        summary: "Delete prompt stash entry",
        description: "Remove a reusable prompt snippet from the Nikcli host.",
        operationId: "mobile.memory.stash.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.object({ success: z.literal(true) })) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c) => {
        const id = c.req.valid("param").id
        const current = await PromptStashStore.list()
        const next = await PromptStashStore.removeByID(id)
        if (next.length === current.length) {
          return c.json({ error: "Prompt snippet not found" }, 404)
        }
        return c.json({ success: true as const })
      },
    )
