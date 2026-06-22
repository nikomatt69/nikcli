/**
 * Doctor — HTTP route exposing the same diagnostics as `nikcli doctor`, so the
 * desktop/web clients can surface setup health without a terminal.
 */

import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { runDoctorChecks } from "../../cli/cmd/doctor"
import { Installation } from "../../installation"

const DoctorCheckSchema = z
  .object({
    ok: z.boolean(),
    label: z.string(),
    detail: z.string().optional(),
    fix: z.string().optional(),
  })
  .meta({ ref: "DoctorCheck" })

const DoctorReportSchema = z
  .object({
    ok: z.boolean(),
    version: z.string(),
    channel: z.string(),
    failures: z.number(),
    results: z.array(DoctorCheckSchema),
  })
  .meta({ ref: "DoctorReport" })

export function DoctorRoutes() {
  return new Hono().get(
    "/",
    describeRoute({
      summary: "Run nikcli doctor",
      description: "Run the diagnostic checks and return a structured report.",
      operationId: "doctor.run",
      responses: {
        200: {
          description: "Doctor report",
          content: { "application/json": { schema: resolver(DoctorReportSchema) } },
        },
      },
    }),
    async (c) => {
      const { ok, results } = await runDoctorChecks()
      return c.json({
        ok,
        version: Installation.VERSION,
        channel: Installation.CHANNEL,
        failures: results.filter((r) => !r.ok).length,
        results,
      })
    },
  )
}
