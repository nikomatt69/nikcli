import { Schema } from "effect"
import z from "zod"

/**
 * zod → Effect Schema.
 *
 * The counterpart of `util/effect-zod.ts`, for the one schema that runs the
 * other way: `Config.Info`. The `nikcli.json` document is ~2200 lines of zod
 * and it is what actually validates the file on disk, so the HTTP contract
 * derives its Effect schema from it instead of keeping a hand-written copy
 * that would drift. Everything else in the contract is Effect-first.
 *
 * `.meta({ ref })` annotations become Effect `identifier`s, so the generated
 * clients get named types (`KeybindsConfig`, `McpLocalConfig`, …) rather than
 * one anonymous blob.
 */

type ZodAny = z.ZodType & {
  readonly _zod: { readonly def: Record<string, any> }
}

/**
 * `.default(x)` is treated as optional rather than required. A parsed config
 * always carries the field, but the same schema also types `PATCH /config`,
 * whose body is a partial document — optional is the shape both directions
 * accept.
 */
const OPTIONAL = Symbol.for("nikcli/zod-effect/optional")

type Converted = { schema: Schema.Top; [OPTIONAL]?: boolean }

const overrides = new WeakMap<z.ZodType, Schema.Top>()

/**
 * Pins the Effect schema for a zod schema whose shape cannot be read off the
 * zod graph — a `.transform()` that changes the output type. Declare it next to
 * the zod definition so the two stay together.
 */
export function overrideZod<S extends Schema.Top>(schema: z.ZodType, effect: S): S {
  overrides.set(schema, effect)
  return effect
}

export function fromZod<T extends z.ZodType>(schema: T): Schema.Codec<z.input<T>, z.input<T>> {
  return convert(schema as ZodAny, new Map()).schema as unknown as Schema.Codec<z.input<T>, z.input<T>>
}

function identifierOf(node: ZodAny): string | undefined {
  const meta = z.globalRegistry.get(node) as { ref?: unknown } | undefined
  return typeof meta?.ref === "string" ? meta.ref : undefined
}

function convert(node: ZodAny, cache: Map<ZodAny, Converted>): Converted {
  const cached = cache.get(node)
  if (cached) return cached
  const override = overrides.get(node)
  if (override) {
    const pinned: Converted = { schema: override }
    cache.set(node, pinned)
    return pinned
  }
  // Placeholder-free: the config schema is a tree, but shared sub-schemas
  // (Keybinds, McpLocal, …) are referenced from several places and converting
  // them once keeps one Effect identifier per zod ref.
  const result = build(node, cache)
  const identifier = identifierOf(node)
  const annotated: Converted = identifier ? { ...result, schema: result.schema.annotate({ identifier }) } : result
  cache.set(node, annotated)
  return annotated
}

function build(node: ZodAny, cache: Map<ZodAny, Converted>): Converted {
  const def = node._zod.def
  switch (def.type) {
    case "string":
      return { schema: Schema.String }
    case "number":
      return { schema: Schema.Number }
    case "boolean":
      return { schema: Schema.Boolean }
    case "null":
      return { schema: Schema.Null }
    case "any":
    case "unknown":
      return { schema: Schema.Unknown }
    case "never":
      return { schema: Schema.Never }
    case "literal": {
      const values = def.values as ReadonlyArray<string | number | boolean | null>
      if (values.length === 1) return { schema: literal(values[0]) }
      return { schema: Schema.Union(values.map(literal)) }
    }
    case "enum": {
      const values = Object.values(def.entries as Record<string, string | number>)
      return { schema: Schema.Literals(values as ReadonlyArray<string>) }
    }
    case "array":
      return { schema: Schema.Array(convert(def.element, cache).schema) }
    case "record":
      return {
        schema: Schema.Record(Schema.String, convert(def.valueType, cache).schema),
      }
    case "union": {
      const members = (def.options as ZodAny[]).map((option) => convert(option, cache).schema)
      return { schema: Schema.Union(members) }
    }
    case "object":
      return { schema: object(node, cache) }
    case "tuple": {
      // Fixed-length positional shapes. `nikcli.json`'s plugin list uses one — a plugin is either
      // a bare specifier or a `[specifier, options]` pair — so this is reachable from the config
      // document, not a hypothetical.
      const items = (def.items as ZodAny[]).map((item) => convert(item, cache).schema)
      const rest = def.rest as ZodAny | undefined
      if (!rest) return { schema: Schema.Tuple(items) }
      return {
        schema: Schema.TupleWithRest(Schema.Tuple(items), [convert(rest, cache).schema]),
      }
    }
    case "optional":
      return { schema: convert(def.innerType, cache).schema, [OPTIONAL]: true }
    case "nullable":
      return {
        schema: Schema.NullOr(convert(def.innerType, cache).schema),
        [OPTIONAL]: true,
      }
    case "default":
    case "prefault":
      return { schema: convert(def.innerType, cache).schema, [OPTIONAL]: true }
    case "pipe": {
      // A pipe pairs a schema with a transform. `.transform()` puts the schema
      // on the input side, `.preprocess()` on the output side; either way the
      // describable half is the one that is not the transform. A transform that
      // changes the output type cannot be read from the graph at all and must
      // be pinned with `overrideZod`.
      const input = def.in as ZodAny
      const output = def.out as ZodAny
      if (output._zod.def.type === "transform") return convert(input, cache)
      if (input._zod.def.type === "transform") return convert(output, cache)
      return convert(output, cache)
    }
    case "lazy":
      return convert(def.getter(), cache)
    case "nonoptional":
    case "readonly":
    case "catch":
      return { schema: convert(def.innerType, cache).schema }
    default:
      // An unmapped node would silently become `any` in every generated
      // client, which is the exact failure this port exists to remove.
      throw new Error(`zod-effect: unsupported zod node "${def.type}"`)
  }
}

function literal(value: string | number | boolean | null) {
  return value === null ? Schema.Null : Schema.Literal(value as string)
}

function object(node: ZodAny, cache: Map<ZodAny, Converted>): Schema.Top {
  const def = node._zod.def
  const source = def.shape as Record<string, ZodAny>
  const fields: Record<string, Schema.Top> = {}
  for (const [key, value] of Object.entries(source)) {
    const converted = convert(value, cache)
    fields[key] = converted[OPTIONAL] ? Schema.optional(converted.schema) : converted.schema
  }
  const struct = Schema.Struct(fields as Schema.Struct.Fields)
  const catchall = def.catchall as ZodAny | undefined
  // `.strict()` compiles to a `never` catchall, which is just a closed struct.
  if (!catchall || catchall._zod.def.type === "never") return struct
  // `.catchall(x)` keeps the declared fields and allows any other key — an
  // index signature alongside the struct, which Effect spells StructWithRest.
  // The rest value admits `undefined` because TypeScript requires every
  // declared property to be assignable to the index signature, and the declared
  // ones here are optional.
  const rest = Schema.Union([convert(catchall, cache).schema, Schema.Undefined])
  return Schema.StructWithRest(struct, [Schema.Record(Schema.String, rest)])
}
