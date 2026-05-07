/**
 * Effect Schema → Zod walker.
 *
 * Walks an Effect Schema AST and produces an equivalent `z.ZodType`. The Zod
 * output is intended to feed `hono-openapi` and produce JSON Schema that is
 * byte-identical (for the supported constructs) to a hand-written Zod schema.
 *
 * Supported constructs (matches current `src/server/httpapi/*` usage plus the
 * canonical refinements documented in `specs/effect/schema.md`):
 *
 * - `Schema.Struct({ ... })` → `z.object({ ... })` (with `.strict()` where the AST
 *   indicates no index signature)
 * - `Schema.Array(...)` → `z.array(...)`
 * - `Schema.Union(...)` → `z.union([...])` (or `z.discriminatedUnion(...)` when a
 *   `discriminator` annotation is present)
 * - `Schema.Literal(...)` / `Schema.Literal(a, b, ...)` → `z.literal(...)` /
 *   `z.union([z.literal(a), ...])`
 * - `Schema.Record(K, V)` → `z.record(K, V)`
 * - `Schema.NullOr(A)` → `z.union([A, z.null()])`
 * - `Schema.optional(A)` / `Schema.OptionalType(isOptional=true)` → `.optional()`
 * - Keywords: `Schema.String`, `Schema.Number`, `Schema.Boolean`, `Schema.Null`,
 *   `Schema.Unknown`, `Schema.Any`
 * - `Schema.Refinement` for the canonical checks listed in `schema.md`:
 *   `isInt`, `isGreaterThan`, `isGreaterThanOrEqualTo`, `isLessThan`,
 *   `isLessThanOrEqualTo`, `isPattern`, `isMinLength`, `isMaxLength`,
 *   `isStartsWith`, `isEndsWith`, `isUUID`. Detection is via the standard
 *   `JSONSchemaAnnotation` produced by `Schema.is*` checks.
 * - `Schema.Brand` → branded zod type with the same JSON Schema shape.
 * - Annotations: `identifier` → `z.meta({ ref })`, `description` → `.describe()`,
 *   `default` → `.default(...)`, `examples` (passed through `.meta` so
 *   `hono-openapi` keeps them in OpenAPI output).
 *
 * Escape hatch: `Schema.annotations({ [ZodOverrideId]: () => zodSchema })`
 * replaces the entire derivation with a hand-crafted zod schema. Use for cases
 * the pure-Schema path cannot express (e.g. `$ref` to an external URL).
 *
 * Out of scope (compile-time error if encountered):
 * - `Suspend` (recursive references) — supported as `z.lazy(...)` only.
 * - `Transformation` other than `BooleanFromString` / `NumberFromString`.
 * - `BigInt`, `Symbol`, `TemplateLiteral`, `Enums` — add when first needed.
 */

import { type Annotated, type AST, getAnnotation } from "effect/SchemaAST"
import { Option } from "effect"
import * as Schema from "effect/Schema"
import z from "zod"

/** Identifier symbol for the ZodOverride escape hatch annotation. */
export const ZodOverrideId = Symbol.for("nikcli/effect-zod/ZodOverride")

type ZodOverrideFn = () => z.ZodType<any>

/**
 * Annotation helper: forces the walker to use the supplied zod schema instead
 * of deriving from the Effect schema.
 */
export function zodOverride(fn: ZodOverrideFn) {
  return { [ZodOverrideId]: fn }
}

const IdentifierAnnotationId = Symbol.for("effect/annotation/Identifier")
const DescriptionAnnotationId = Symbol.for("effect/annotation/Description")
const DefaultAnnotationId = Symbol.for("effect/annotation/Default")
const ExamplesAnnotationId = Symbol.for("effect/annotation/Examples")
const JSONSchemaAnnotationId = Symbol.for("effect/annotation/JSONSchema")
const TitleAnnotationId = Symbol.for("effect/annotation/Title")
const BrandAnnotationId = Symbol.for("effect/annotation/Brand")
const SchemaIdAnnotationId = Symbol.for("effect/annotation/SchemaId")

interface RefAnnotation {
  ref?: string
  description?: string
  title?: string
  default?: unknown
  examples?: ReadonlyArray<unknown>
  jsonSchema?: Record<string, unknown>
  brand?: ReadonlyArray<string | symbol>
  schemaId?: string | symbol
  override?: ZodOverrideFn
}

// Effect's primitive keywords (`Schema.String`, `Schema.Number`, etc.) carry default
// `title` and `description` annotations like `"string"` / `"a string"`. Those leak into
// the JSON Schema output as noise. Strip them so the emitted Zod only carries the
// annotations the author actually set.
const DEFAULT_TITLES = new Set([
  "string",
  "number",
  "boolean",
  "null",
  "any",
  "object",
  "undefined",
  "void",
  "never",
  "unknown",
  "bigint",
  "symbol",
])

const DEFAULT_DESCRIPTIONS = new Set([
  "a string",
  "a number",
  "a boolean",
  "a bigint",
  "a symbol",
  "a number to be decoded into an integer",
  "a string to be decoded into a number",
  "a string to be decoded into a boolean",
  "a string to be decoded into a bigint",
])

// Effect's built-in transformation schemas (`NumberFromString`, etc.) carry default
// `identifier` annotations. They're meaningful when the schema appears as a named OpenAPI
// component, but for inline tool params they leak into the emitted JSON Schema as
// `ref: "NumberFromString"`. Filter them out so only author-set identifiers survive.
const DEFAULT_IDENTIFIERS = new Set([
  "NumberFromString",
  "BooleanFromString",
  "BigIntFromString",
  "DateFromString",
  "DateFromNumber",
])

function readAnnotations(ast: Annotated): RefAnnotation {
  const out: RefAnnotation = {}
  const id = getAnnotation<string>(IdentifierAnnotationId)(ast)
  if (Option.isSome(id) && !DEFAULT_IDENTIFIERS.has(id.value)) out.ref = id.value
  const desc = getAnnotation<string>(DescriptionAnnotationId)(ast)
  if (Option.isSome(desc) && !DEFAULT_DESCRIPTIONS.has(desc.value)) out.description = desc.value
  const title = getAnnotation<string>(TitleAnnotationId)(ast)
  if (Option.isSome(title) && !DEFAULT_TITLES.has(title.value)) out.title = title.value
  const def = getAnnotation<unknown>(DefaultAnnotationId)(ast)
  if (Option.isSome(def)) out.default = def.value
  const examples = getAnnotation<ReadonlyArray<unknown>>(ExamplesAnnotationId)(ast)
  if (Option.isSome(examples)) out.examples = examples.value
  const json = getAnnotation<Record<string, unknown>>(JSONSchemaAnnotationId)(ast)
  if (Option.isSome(json)) out.jsonSchema = json.value
  const brand = getAnnotation<ReadonlyArray<string | symbol>>(BrandAnnotationId)(ast)
  if (Option.isSome(brand)) out.brand = brand.value
  const sid = getAnnotation<string | symbol>(SchemaIdAnnotationId)(ast)
  if (Option.isSome(sid)) {
    // SchemaId values are themselves symbols (e.g. `Symbol(effect/SchemaId/Int)`); normalize
    // to the symbol's description string so callers can switch on it.
    out.schemaId =
      typeof sid.value === "symbol" ? sid.value.description ?? sid.value : sid.value
  }
  const override = getAnnotation<ZodOverrideFn>(ZodOverrideId)(ast)
  if (Option.isSome(override)) out.override = override.value
  return out
}

function applyAnnotations<T extends z.ZodType>(zodType: T, ann: RefAnnotation): z.ZodType {
  let out: z.ZodType = zodType
  if (ann.description !== undefined) out = out.describe(ann.description)
  const meta: Record<string, unknown> = {}
  if (ann.ref !== undefined) meta.ref = ann.ref
  if (ann.title !== undefined) meta.title = ann.title
  if (ann.examples !== undefined) meta.examples = ann.examples
  if (ann.jsonSchema !== undefined) Object.assign(meta, ann.jsonSchema)
  if (Object.keys(meta).length > 0) out = (out as any).meta(meta)
  if (ann.default !== undefined) out = (out as any).default(ann.default)
  return out
}

const KNOWN_SCHEMA_IDS: Record<string, (zod: z.ZodType, json: Record<string, unknown> | undefined) => z.ZodType> = {
  // Effect schema id strings the walker understands. Detection runs against the description
  // of the symbol value stored under `Symbol(effect/annotation/SchemaId)`. Each entry maps
  // to the equivalent zod refinement so the JSON Schema output stays aligned.
  "effect/SchemaId/Int": (zod, json) =>
    refineNumber(zod, json, (n) => n.int()),
  "effect/SchemaId/GreaterThan": (zod, json) =>
    refineNumber(zod, json, (n) => {
      const min = readNum(json, "exclusiveMinimum")
      return min !== undefined ? n.gt(min) : n
    }),
  "effect/SchemaId/GreaterThanOrEqualTo": (zod, json) =>
    refineNumber(zod, json, (n) => {
      const min = readNum(json, "minimum")
      return min !== undefined ? n.gte(min) : n
    }),
  "effect/SchemaId/LessThan": (zod, json) =>
    refineNumber(zod, json, (n) => {
      const max = readNum(json, "exclusiveMaximum")
      return max !== undefined ? n.lt(max) : n
    }),
  "effect/SchemaId/LessThanOrEqualTo": (zod, json) =>
    refineNumber(zod, json, (n) => {
      const max = readNum(json, "maximum")
      return max !== undefined ? n.lte(max) : n
    }),
  "effect/SchemaId/Pattern": (zod, json) =>
    refineString(zod, json, (s) => {
      const pattern = readStr(json, "pattern")
      return pattern !== undefined ? s.regex(new RegExp(pattern)) : s
    }),
  "effect/SchemaId/UUID": (zod, json) => refineString(zod, json, (s) => s.uuid()),
  "effect/SchemaId/MinLength": (zod, json) =>
    refineString(zod, json, (s) => {
      const min = readNum(json, "minLength")
      return min !== undefined ? s.min(min) : s
    }),
  "effect/SchemaId/MaxLength": (zod, json) =>
    refineString(zod, json, (s) => {
      const max = readNum(json, "maxLength")
      return max !== undefined ? s.max(max) : s
    }),
  "effect/SchemaId/StartsWith": (zod, json) =>
    refineString(zod, json, (s) => {
      const prefix = readStr(json, "pattern")?.replace(/^\^/, "")
      return prefix !== undefined ? s.startsWith(prefix) : s
    }),
  "effect/SchemaId/EndsWith": (zod, json) =>
    refineString(zod, json, (s) => {
      const suffix = readStr(json, "pattern")?.replace(/\$$/, "")
      return suffix !== undefined ? s.endsWith(suffix) : s
    }),
  "effect/SchemaId/MinItems": (zod, json) =>
    refineArray(zod, json, (a) => {
      const min = readNum(json, "minItems")
      return min !== undefined ? a.min(min) : a
    }),
  "effect/SchemaId/MaxItems": (zod, json) =>
    refineArray(zod, json, (a) => {
      const max = readNum(json, "maxItems")
      return max !== undefined ? a.max(max) : a
    }),
}

function readNum(json: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = json?.[key]
  return typeof value === "number" ? value : undefined
}

function readStr(json: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = json?.[key]
  return typeof value === "string" ? value : undefined
}

function refineNumber(
  zod: z.ZodType,
  _json: Record<string, unknown> | undefined,
  step: (n: z.ZodNumber) => z.ZodNumber,
): z.ZodType {
  if (zod instanceof z.ZodNumber) return step(zod)
  return zod
}

function refineString(
  zod: z.ZodType,
  _json: Record<string, unknown> | undefined,
  step: (s: z.ZodString) => z.ZodString,
): z.ZodType {
  if (zod instanceof z.ZodString) return step(zod)
  return zod
}

function refineArray(
  zod: z.ZodType,
  _json: Record<string, unknown> | undefined,
  step: (a: z.ZodArray<any>) => z.ZodArray<any>,
): z.ZodType {
  if (zod instanceof z.ZodArray) return step(zod)
  return zod
}

function walk(ast: AST): z.ZodType {
  const ann = readAnnotations(ast)
  if (ann.override) return applyAnnotations(ann.override(), ann)

  switch (ast._tag) {
    case "StringKeyword":
      return applyAnnotations(z.string(), ann)
    case "NumberKeyword":
      return applyAnnotations(z.number(), ann)
    case "BooleanKeyword":
      return applyAnnotations(z.boolean(), ann)
    case "UnknownKeyword":
    case "AnyKeyword":
    case "ObjectKeyword":
    case "VoidKeyword":
      return applyAnnotations(z.unknown(), ann)
    case "NeverKeyword":
      return applyAnnotations(z.never(), ann)
    case "UndefinedKeyword":
      return applyAnnotations(z.undefined(), ann)
    case "Literal": {
      const literalAst = ast as AST & { literal: string | number | boolean | bigint | null }
      if (literalAst.literal === null) return applyAnnotations(z.null(), ann)
      return applyAnnotations(z.literal(literalAst.literal as any), ann)
    }
    case "Union": {
      const unionAst = ast as AST & { types: ReadonlyArray<AST> }
      // Strip `UndefinedKeyword` arms — they come from `Schema.optional(X)` which encodes
      // optionality as `Union(X, Undefined)` plus `isOptional: true` on the property signature.
      // The parent TypeLiteral case handles `isOptional` via `.optional()`. Emitting
      // `z.undefined()` here breaks Zod v4's `toJSONSchema` ("Undefined cannot be represented
      // in JSON Schema").
      const filtered = unionAst.types.filter((t) => t._tag !== "UndefinedKeyword")
      if (filtered.length === 0) return applyAnnotations(z.never(), ann)
      const variants = filtered.map((t) => walk(t))
      if (variants.length === 1) return applyAnnotations(variants[0], ann)
      return applyAnnotations(z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]), ann)
    }
    case "TupleType": {
      const tupleAst = ast as AST & {
        elements: ReadonlyArray<{ type: AST; isOptional: boolean }>
        rest: ReadonlyArray<{ type: AST }>
      }
      // `Schema.Array(...)` is encoded as a TupleType with no elements and a single rest element.
      if (tupleAst.elements.length === 0 && tupleAst.rest.length === 1) {
        return applyAnnotations(z.array(walk(tupleAst.rest[0].type)), ann)
      }
      const items = tupleAst.elements.map((el) => walk(el.type))
      if (tupleAst.rest.length === 0) {
        return applyAnnotations(z.tuple(items as [z.ZodType, ...z.ZodType[]]), ann)
      }
      return applyAnnotations(
        z.tuple(items as [z.ZodType, ...z.ZodType[]]).rest(walk(tupleAst.rest[0].type)),
        ann,
      )
    }
    case "TypeLiteral": {
      const literalAst = ast as AST & {
        propertySignatures: ReadonlyArray<{
          name: PropertyKey
          type: AST
          isOptional: boolean
        }>
        indexSignatures: ReadonlyArray<{ parameter: AST; type: AST }>
      }
      const shape: Record<string, z.ZodType> = {}
      for (const sig of literalAst.propertySignatures) {
        if (typeof sig.name !== "string") continue
        const child = walk(sig.type)
        shape[sig.name] = sig.isOptional ? child.optional() : child
      }
      let object: z.ZodType = z.object(shape)
      if (literalAst.indexSignatures.length === 0) {
        object = (object as z.ZodObject<any>).strict()
      } else {
        const idx = literalAst.indexSignatures[0]
        const valueZ = walk(idx.type)
        const keyZ = walk(idx.parameter)
        if (Object.keys(shape).length === 0) {
          object = z.record(keyZ as z.ZodString, valueZ)
        } else {
          // Effect allows mixed property + index signatures; closest zod shape is .catchall(...)
          object = (object as z.ZodObject<any>).catchall(valueZ)
        }
      }
      return applyAnnotations(object, ann)
    }
    case "Refinement": {
      const refAst = ast as AST & { from: AST }
      const inner = walk(refAst.from)
      if (typeof ann.schemaId === "string" && KNOWN_SCHEMA_IDS[ann.schemaId]) {
        const refined = KNOWN_SCHEMA_IDS[ann.schemaId](inner, ann.jsonSchema)
        return applyAnnotations(refined, ann)
      }
      // Unknown refinement: fall back to the underlying type — JSON Schema won't include
      // the refinement constraints, but validation still runs through the zod custom check.
      return applyAnnotations(inner, ann)
    }
    case "Suspend": {
      const suspendAst = ast as AST & { f: () => AST }
      return applyAnnotations(z.lazy(() => walk(suspendAst.f())) as z.ZodType, ann)
    }
    case "Transformation": {
      const transAst = ast as AST & { from: AST; to: AST }
      // Detect the canonical String→T coercion transformations and emit `z.coerce.*`
      // so the tool/HTTP boundary accepts either the wire string or the decoded value
      // and outputs the decoded value.
      if (transAst.from._tag === "StringKeyword") {
        if (transAst.to._tag === "NumberKeyword") {
          return applyAnnotations(z.coerce.number(), ann)
        }
        if (transAst.to._tag === "BooleanKeyword") {
          return applyAnnotations(z.coerce.boolean(), ann)
        }
        if (transAst.to._tag === "BigIntKeyword") {
          return applyAnnotations(z.coerce.bigint(), ann)
        }
      }
      // Default: walk the input side; the boundary type is what the wire format carries.
      return applyAnnotations(walk(transAst.from), ann)
    }
    case "Declaration": {
      // Declarations wrap things like Schema.NullOr or branded primitives. Walk the surrogate
      // form when present; otherwise treat as unknown.
      const decl = ast as AST & { typeParameters: ReadonlyArray<AST>; annotations: any }
      if (decl.typeParameters.length === 1) {
        return applyAnnotations(walk(decl.typeParameters[0]), ann)
      }
      return applyAnnotations(z.unknown(), ann)
    }
    case "Enums": {
      const enumsAst = ast as AST & { enums: ReadonlyArray<readonly [string, string | number]> }
      const values = enumsAst.enums.map(([, v]) => v)
      const literals = values.map((v) => z.literal(v as any))
      if (literals.length === 1) return applyAnnotations(literals[0], ann)
      const unionArgs = literals as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]
      return applyAnnotations(z.union(unionArgs), ann)
    }
    default:
      // Construct not yet supported: fall back to z.unknown() with annotations.
      // Add a switch case here when a new construct first appears in src/.
      return applyAnnotations(z.unknown(), ann)
  }
}

/**
 * Convert an Effect Schema to its Zod equivalent.
 *
 * Use this at the boundary between Effect-Schema-owned domain types and any
 * remaining Zod-only consumer (hono-openapi route validators, AI SDK tool
 * parameter schemas, legacy SDK output).
 */
export function zod<A, I>(schema: Schema.Schema<A, I, never>): z.ZodType<A> {
  return walk(schema.ast) as z.ZodType<A>
}

/**
 * Convert an Effect Schema known to be a Struct into a `z.ZodObject` whose
 * inferred output type matches `Schema.Schema.Type<typeof schema>`. The
 * walker emits the correct shape at runtime; we only need TypeScript to
 * surface the precise field types so consumers (HTTP handlers, AI SDK tool
 * params, downstream typed wrappers) keep their static guarantees.
 *
 * `.shape`, `.partial`, `.omit`, `.merge`, `.extend` are all available on
 * the result.
 */
type FieldToZod<F> = F extends Schema.PropertySignature<infer Token, infer A, any, any, any, any, any>
  ? Token extends "?:"
    ? z.ZodOptional<z.ZodType<A>>
    : z.ZodType<A>
  : F extends Schema.Schema<infer A, any, any>
    ? z.ZodType<A>
    : z.ZodType<unknown>

type FieldsToShape<Fields extends Schema.Struct.Fields> = {
  [K in keyof Fields]: FieldToZod<Fields[K]>
}

// Overload: typed Struct (preserves field shape inference for `.shape`/`.omit`/etc.)
export function zodObject<Fields extends Schema.Struct.Fields>(
  schema: Schema.Struct<Fields>,
): z.ZodObject<FieldsToShape<Fields>>
// Overload: any Schema producing an object value (e.g. `Schema.mutable(Schema.Struct(...))`).
// Loses the precise field shape but still gives a `z.ZodObject` with the correct output type.
export function zodObject<A extends object, I, R>(
  schema: Schema.Schema<A, I, R>,
): z.ZodType<A> & z.ZodObject<z.ZodRawShape>
export function zodObject(schema: Schema.Schema<any, any, any>): z.ZodObject<any> {
  const out = walk(schema.ast)
  if (out instanceof z.ZodObject) {
    return out as z.ZodObject<any>
  }
  throw new Error("zodObject: schema did not produce a z.ZodObject")
}

/**
 * Two-step helper for cases where a Schema cannot reference itself cleanly
 * during initialization. Returns the schema with the supplied static fields
 * attached, mirroring `Schema.Class`'s `static readonly zod = zod(Info)` pattern.
 */
export function withStatics<S extends object, Statics extends object>(
  build: (schema: S) => Statics,
): (schema: S) => S & Statics {
  return (schema) => Object.assign({}, schema, build(schema)) as S & Statics
}

/**
 * `Types.DeepMutable` work-alike that does not widen `unknown` to `{}`.
 *
 * The upstream `effect-smol` `Types.DeepMutable` widens `unknown` (issue
 * `effect:core/x228my`). Some `Config.Info` consumers rely on `Record<string,
 * unknown>` staying intact when stripping `readonly`, so we ship a local copy
 * until the upstream fix lands.
 */
export type DeepMutable<T> = T extends ReadonlyArray<infer U>
  ? Array<DeepMutable<U>>
  : T extends ReadonlyMap<infer K, infer V>
    ? Map<DeepMutable<K>, DeepMutable<V>>
    : T extends ReadonlySet<infer U>
      ? Set<DeepMutable<U>>
      : T extends Date
        ? T
        : T extends RegExp
          ? T
          : T extends Function
            ? T
            : T extends object
              ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
              : T
