import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import path from "path"
import { File } from "../../file"
import { SearchBackend } from "../../file/searchBackend"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using the configured search backend.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(SearchBackend.Match.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) => {
        const pattern = c.req.valid("query").pattern
        const result = await SearchBackend.search({
          cwd: Instance.directory,
          pattern,
          limit: 10,
        })
        return c.json(result.matches)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const dirs = c.req.valid("query").dirs
        const type = c.req.valid("query").type
        const limit = c.req.valid("query").limit
        const results = await File.search({
          query,
          limit: limit ?? 10,
          dirs: dirs !== "false",
          type,
        })
        return c.json(results)
      },
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) => {
        /*
      const query = c.req.valid("query").query
      const result = await LSP.workspaceSymbol(query)
      return c.json(result)
      */
        return c.json([])
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const requestedPath = c.req.valid("query").path
        const absolutePath = path.isAbsolute(requestedPath)
          ? requestedPath
          : path.join(Instance.directory, requestedPath)
        const normalizedPath = path.normalize(absolutePath)
        const content = await File.list(normalizedPath)
        return c.json(content)
      },
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const requestedPath = c.req.valid("query").path
        const absolutePath = path.isAbsolute(requestedPath)
          ? requestedPath
          : path.join(Instance.directory, requestedPath)
        const normalizedPath = path.normalize(absolutePath)
        const content = await File.read(normalizedPath)
        return c.json(content)
      },
    )
    .get(
      "/file/status",
      describeRoute({
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
        operationId: "file.status",
        responses: {
          200: {
            description: "File status",
            content: {
              "application/json": {
                schema: resolver(File.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const content = await File.status()
        return c.json(content)
      },
    )
    .put(
      "/file/content",
      describeRoute({
        summary: "Write file",
        description: "Write content to a specified file within the project directory.",
        operationId: "file.write",
        responses: {
          200: {
            description: "Write result",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          path: z.string(),
          content: z.string(),
        }),
      ),
      async (c) => {
        const { path: requestedPath, content } = c.req.valid("json")
        const absolutePath = path.isAbsolute(requestedPath)
          ? requestedPath
          : path.join(Instance.directory, requestedPath)
        const normalizedPath = path.normalize(absolutePath)
        await Bun.write(normalizedPath, content)
        return c.json({ success: true })
      },
    ),
)
