import { Schema } from "effect"
import { zodObject } from "@/util/effect-zod"
import type { DeepMutable } from "@/util/effect-zod"

/**
 * Canonical Effect Schema for the in-process provider + model records.
 *
 * Two representations coexist in this codebase:
 * - `ModelsDev.Model` / `ModelsDev.Provider` (`./models.ts`): the upstream
 *   shape returned by models.dev and used to seed the catalog.
 * - `Provider.Model` / `Provider.Info` (this file): the normalized internal
 *   shape that the rest of the codebase consumes.
 *
 * Keeping the canonical schema here, separate from the build pipeline that
 * loads and merges catalogs (`provider.ts`), makes the contract
 * importable from any consumer without dragging the SDK factory or
 * models.dev loader with it.
 */

export const CostBlockSchema = Schema.Struct({
  read: Schema.Number,
  write: Schema.Number,
})

export const CapabilitiesIOSchema = Schema.Struct({
  text: Schema.Boolean,
  audio: Schema.Boolean,
  image: Schema.Boolean,
  video: Schema.Boolean,
  pdf: Schema.Boolean,
})

export const ModelSchema = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  api: Schema.Struct({
    id: Schema.String,
    // Optional: custom / config-only providers often leave the base URL
    // implicit (resolved later from provider options.baseURL or npm defaults).
    // Required here would reject real /config/providers payloads at the
    // Effect HttpApi boundary even though Hono never validated them.
    url: Schema.optional(Schema.String),
    npm: Schema.String,
  }),
  name: Schema.String,
  family: Schema.optional(Schema.String),
  capabilities: Schema.Struct({
    temperature: Schema.Boolean,
    reasoning: Schema.Boolean,
    attachment: Schema.Boolean,
    toolcall: Schema.Boolean,
    input: CapabilitiesIOSchema,
    output: CapabilitiesIOSchema,
    interleaved: Schema.Union([
      Schema.Boolean,
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  }),
  cost: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    cache: CostBlockSchema,
    experimentalOver200K: Schema.optional(
      Schema.Struct({
        input: Schema.Number,
        output: Schema.Number,
        cache: CostBlockSchema,
      }),
    ),
  }),
  limit: Schema.Struct({
    context: Schema.Number,
    input: Schema.optional(Schema.Number),
    output: Schema.Number,
  }),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  options: Schema.Record(Schema.String, Schema.Unknown),
  headers: Schema.Record(Schema.String, Schema.String),
  release_date: Schema.String,
  variants: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
}).annotate({ identifier: "Model" })
export const Model = zodObject(ModelSchema)
export type Model = DeepMutable<Schema.Schema.Type<typeof ModelSchema>>

export const InfoSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.Literals(["env", "config", "custom", "api"]),
  env: Schema.mutable(Schema.Array(Schema.String)),
  key: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  models: Schema.Record(Schema.String, ModelSchema),
}).annotate({ identifier: "Provider" })
export const Info = zodObject(InfoSchema)
export type Info = DeepMutable<Schema.Schema.Type<typeof InfoSchema>>
