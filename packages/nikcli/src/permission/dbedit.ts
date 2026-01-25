import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import z from "zod"
import type { DBEditRequest } from "../cli/cmd/tui/component/table-db/db/types"

export namespace DBEditNext {
  const log = Log.create({ service: "dbedit" })

  export const Request = z
    .object({
      id: Identifier.schema("dbedit"),
      sessionID: Identifier.schema("session"),
      type: z.enum(["db_create", "db_edit", "db_query"]),
      filePath: z.string(),
      schema: z
        .object({
          tables: z.array(
            z.object({
              name: z.string(),
              columns: z.array(
                z.object({
                  name: z.string(),
                  type: z.string(),
                  notNull: z.boolean(),
                  defaultValue: z.string().optional(),
                  primaryKey: z.boolean(),
                }),
              ),
              primaryKey: z.string().array(),
              foreignKeys: z
                .array(
                  z.object({
                    table: z.string(),
                    column: z.string(),
                    referencedTable: z.string(),
                    referencedColumn: z.string(),
                    onDelete: z.enum(["CASCADE", "RESTRICT", "SET NULL", "NO ACTION"]),
                  }),
                )
                .optional(),
              rowCount: z.number().optional(),
              sql: z.string().optional(),
            }),
          ),
          views: z
            .array(
              z.object({
                name: z.string(),
                sql: z.string(),
              }),
            )
            .optional(),
          indexes: z
            .array(
              z.object({
                name: z.string(),
                tableName: z.string(),
                columns: z.string().array(),
                unique: z.boolean(),
              }),
            )
            .optional(),
        })
        .optional(),
      preview: z
        .array(
          z.object({
            tableName: z.string(),
            columns: z.array(
              z.object({
                name: z.string(),
                type: z.string(),
                notNull: z.boolean(),
                defaultValue: z.string().optional(),
                primaryKey: z.boolean(),
              }),
            ),
            sampleData: z.array(z.record(z.string(), z.any())),
            rowCount: z.number(),
          }),
        )
        .optional(),
      changes: z
        .array(
          z.object({
            type: z.enum(["add_table", "drop_table", "add_column", "drop_column", "modify_column"]),
            tableName: z.string(),
            columnName: z.string().optional(),
            oldDefinition: z
              .object({
                name: z.string(),
                type: z.string(),
                notNull: z.boolean(),
                defaultValue: z.string().optional(),
                primaryKey: z.boolean(),
              })
              .optional(),
            newDefinition: z
              .object({
                name: z.string(),
                type: z.string(),
                notNull: z.boolean(),
                defaultValue: z.string().optional(),
                primaryKey: z.boolean(),
              })
              .optional(),
          }),
        )
        .optional(),
      sql: z.string().optional(),
      always: z.string().array(),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "DBEditRequest",
    })

  export type Request = DBEditRequest

  export const Reply = z.enum(["accept", "edit", "reject"])
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("dbedit.asked", Request),
    Replied: BusEvent.define(
      "dbedit.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        reply: Reply,
      }),
    ),
  }

  const state = Instance.state(async () => {
    const projectID = Instance.project.id
    return {
      pending: {} as Record<
        string,
        {
          info: Request
          resolve: (modified?: Request) => void
          reject: (e: any) => void
        }
      >,
    }
  })

  export const ask = fn(Request.partial({ id: true }), async (input) => {
    const s = await state()
    const id = input.id ?? Identifier.ascending("dbedit")

    return new Promise<Request | undefined>((resolve, reject) => {
      const info: Request = {
        id,
        ...input,
      }
      s.pending[id] = {
        info,
        resolve: (modified) => resolve(modified ?? info),
        reject,
      }
      Bus.publish(Event.Asked, info)
    })
  })

  export const reply = fn(
    z.object({
      requestID: Identifier.schema("dbedit"),
      reply: Reply,
      modified: Request.optional(),
      message: z.string().optional(),
    }),
    async (input) => {
      const s = await state()
      const existing = s.pending[input.requestID]
      if (!existing) return

      delete s.pending[input.requestID]

      if (input.reply === "reject") {
        Bus.publish(Event.Replied, {
          sessionID: existing.info.sessionID,
          requestID: existing.info.id,
          reply: "reject",
        })
        existing.reject(new RejectedError(input.message))
        return
      }

      if (input.reply === "accept") {
        Bus.publish(Event.Replied, {
          sessionID: existing.info.sessionID,
          requestID: existing.info.id,
          reply: "accept",
        })
        existing.resolve()
        return
      }

      if (input.reply === "edit" && input.modified) {
        Bus.publish(Event.Replied, {
          sessionID: existing.info.sessionID,
          requestID: existing.info.id,
          reply: "edit",
        })
        existing.resolve(input.modified)
        return
      }
    },
  )

  export async function list() {
    return state().then((x) => Object.values(x.pending).map((x) => x.info))
  }

  export class RejectedError extends Error {
    constructor(message?: string) {
      super(
        message
          ? `The user rejected database changes with feedback: ${message}`
          : `The user rejected the database changes.`,
      )
    }
  }
}
