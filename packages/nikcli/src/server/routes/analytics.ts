import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Analytics } from "../../analytics/analytics"
import { Log } from "../../util/log"

const log = Log.create({ service: "analytics-routes" })

export function AnalyticsRoutes() {
  return new Hono()
    .get(
      "/global",
      describeRoute({
        summary: "Get global analytics",
        description: "Retrieve cumulative global analytics across all sessions.",
        operationId: "analytics.global",
        responses: {
          200: {
            description: "Global analytics",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      async (c) => {
        const global = await Analytics.getGlobal()
        return c.json(global)
      },
    )
    .get(
      "/daily",
      describeRoute({
        summary: "Get daily analytics",
        description: "Retrieve daily analytics snapshots for a date range.",
        operationId: "analytics.daily",
        responses: {
          200: {
            description: "Daily analytics",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          from: z.string().optional(),
          to: z.string().optional(),
          days: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const to = query.to || new Date().toISOString().split("T")[0]
        let from = query.from

        if (!from) {
          const days = parseInt(query.days || "90", 10)
          const d = new Date()
          d.setUTCDate(d.getUTCDate() - days)
          from = d.toISOString().split("T")[0]
        }

        const daily = await Analytics.getDaily(from, to)
        return c.json(daily)
      },
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Get session analytics",
        description: "Retrieve analytics for a specific session.",
        operationId: "analytics.session",
        responses: {
          200: {
            description: "Session analytics",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
          404: {
            description: "Session not found",
          },
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const session = await Analytics.getSession(sessionID)
        if (!session) {
          return c.json({ error: "Session not found" }, 404)
        }
        return c.json(session)
      },
    )
    .get(
      "/sessions",
      describeRoute({
        summary: "Get all session analytics",
        description: "Retrieve analytics summaries for all completed sessions.",
        operationId: "analytics.sessions",
        responses: {
          200: {
            description: "Session analytics list",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
        },
      }),
      async (c) => {
        const sessions = await Analytics.getAllSessions()
        return c.json(sessions)
      },
    )
    .get(
      "/leaderboard",
      describeRoute({
        summary: "Get analytics leaderboard",
        description: "Retrieve ranked models, providers, and tools by various metrics.",
        operationId: "analytics.leaderboard",
        responses: {
          200: {
            description: "Leaderboard data",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      async (c) => {
        const global = await Analytics.getGlobal()

        // Rank models by token usage
        const models = Object.entries(global.byModel)
          .map(([key, stats]) => ({
            key,
            providerID: key.split("/")[0],
            modelID: key.split("/").slice(1).join("/"),
            ...stats,
            totalTokens: stats.tokens.input + stats.tokens.output + stats.tokens.reasoning,
          }))
          .sort((a, b) => b.totalTokens - a.totalTokens)

        // Rank providers by cost
        const providers = Object.entries(global.byProvider)
          .map(([id, stats]) => ({ id, ...stats }))
          .sort((a, b) => b.cost - a.cost)

        // Rank projects by activity
        const projects = Object.entries(global.byProject)
          .map(([id, stats]) => ({ id, ...stats }))
          .sort((a, b) => b.lastActive - a.lastActive)

        return c.json({ models, providers, projects })
      },
    )
}
