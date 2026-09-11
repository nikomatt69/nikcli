/**
 * The v2 plugin manifest: what a plugin is, what it may do, and what host it
 * needs.
 *
 * `specs/effect-tui/14-plugin-v2-architecture.md` requirements 2, 6 and 11. The
 * manifest is also the **discriminator**: a module carrying one is a v2 plugin,
 * a module without one is not. That is why it lives in the contract package
 * rather than in a runtime — both the TUI runtime and the server-side loader
 * have to agree on the shape without importing each other.
 *
 * Declaring a capability does not grant it. The host decides what it can
 * supply; the manifest only says what the plugin will ask for. A plugin that
 * calls a capability it did not declare fails with `CapabilityDenied` rather
 * than silently receiving a stub — a stub would make the plugin look like it
 * worked.
 */
import { Schema } from "effect"

/**
 * What a plugin may reach for.
 *
 * The TUI runtime can supply `routes`, `storage` and `http` today. The rest are
 * declared here because the manifest is the stable contract: a plugin written
 * against a future host should not need a new manifest version to say what it
 * wants, and a host that cannot supply a capability refuses at load rather than
 * failing at the first call.
 */
export const Capability = Schema.Literals(["tools", "commands", "routes", "keymap", "scheduler", "storage", "http"])
export type Capability = typeof Capability.Type

/**
 * Where a plugin came from.
 *
 * `remote-disabled` is a real state, not a placeholder: remote loading is out
 * of scope for v2, so a manifest that claims it is accepted and refused, which
 * is more useful than an unknown-kind error.
 */
export const Kind = Schema.Literals(["internal", "user", "remote-disabled"])
export type Kind = typeof Kind.Type

/** Semver ranges the host must satisfy. An absent field is "no requirement". */
export const HostRequirements = Schema.Struct({
  nikcli: Schema.optional(Schema.String),
  effect: Schema.optional(Schema.String),
  opentui: Schema.optional(Schema.String),
  node: Schema.optional(Schema.String),
})
export type HostRequirements = typeof HostRequirements.Type

/**
 * What the plugin intends to touch outside its own process state.
 *
 * Recorded, not yet enforced — enforcement is EOT-17's permission evaluator,
 * and wiring it here before that exists would mean two evaluators. Present in
 * the manifest now so a plugin does not have to change its manifest to become
 * enforceable later.
 */
export const Permissions = Schema.Struct({
  filesystem: Schema.optional(Schema.Array(Schema.String)),
  network: Schema.optional(Schema.Array(Schema.String)),
  command: Schema.optional(Schema.Array(Schema.String)),
})
export type Permissions = typeof Permissions.Type

/**
 * Plugin ids are scoped — `org:plugin` — so two authors can ship a `git`
 * plugin. The scope is also what namespaces route names, slot ids and storage
 * keys, which is why the separator is fixed rather than a convention.
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/

export const ManifestSchema = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  kind: Kind,
  capabilities: Schema.Array(Capability),
  hostRequirements: Schema.optional(HostRequirements),
  permissions: Schema.optional(Permissions),
}).annotate({ identifier: "PluginV2Manifest" })

export type Manifest = typeof ManifestSchema.Type

/**
 * Each error renders its own `message`.
 *
 * `Schema.TaggedError` carries the structured fields but leaves `message`
 * empty, and these surface through a plugin loader whose output a human reads
 * in a terminal. An empty message there is a loader that says a plugin failed
 * and not why.
 */
export class ManifestInvalid extends Schema.TaggedError<ManifestInvalid>()("PluginV2ManifestInvalid", {
  spec: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Invalid v2 plugin manifest in ${this.spec}: ${this.reason}`
  }
}

export class Incompatible extends Schema.TaggedError<Incompatible>()("PluginV2Incompatible", {
  pluginID: Schema.String,
  requirement: Schema.String,
  required: Schema.String,
  actual: Schema.String,
}) {
  override get message() {
    return `Plugin ${this.pluginID} requires ${this.requirement} ${this.required} but the host is ${this.actual}`
  }
}

export class CapabilityDenied extends Schema.TaggedError<CapabilityDenied>()("PluginV2CapabilityDenied", {
  pluginID: Schema.String,
  capability: Capability,
  reason: Schema.String,
}) {
  override get message() {
    return `Plugin ${this.pluginID} was denied capability "${this.capability}": ${this.reason}`
  }
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Validate a candidate manifest.
 *
 * Throws `ManifestInvalid` rather than returning an option: a malformed
 * manifest is a load failure the operator has to see, and the alternative —
 * treating it as "not a v2 plugin" — would silently fall back to the v1 path
 * and report a confusing shape error from there instead.
 */
export function parseManifest(value: unknown, spec: string): Manifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestInvalid({ spec, reason: "manifest must be an object" })
  }

  const raw = value as Record<string, unknown>

  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
    throw new ManifestInvalid({
      spec,
      reason: `manifest.id must be a scoped lowercase id like "org:plugin", got ${JSON.stringify(raw.id)}`,
    })
  }

  if (typeof raw.version !== "string" || !SEMVER_PATTERN.test(raw.version)) {
    throw new ManifestInvalid({
      spec,
      reason: `manifest.version must be semver, got ${JSON.stringify(raw.version)}`,
    })
  }

  if (raw.kind !== "internal" && raw.kind !== "user" && raw.kind !== "remote-disabled") {
    throw new ManifestInvalid({
      spec,
      reason: `manifest.kind must be "internal", "user" or "remote-disabled", got ${JSON.stringify(raw.kind)}`,
    })
  }

  if (!Array.isArray(raw.capabilities)) {
    throw new ManifestInvalid({ spec, reason: "manifest.capabilities must be an array" })
  }

  const allowed = new Set<string>(Capability.literals)
  for (const capability of raw.capabilities) {
    if (typeof capability !== "string" || !allowed.has(capability)) {
      throw new ManifestInvalid({
        spec,
        reason: `unknown capability ${JSON.stringify(capability)}; expected one of ${Capability.literals.join(", ")}`,
      })
    }
  }

  // An empty module is a compatibility failure per requirement 1, and a plugin
  // that asks for nothing is the same thing one step earlier: it cannot do
  // anything the host would notice, so loading it only produces a lifetime to
  // manage.
  if (raw.capabilities.length === 0) {
    throw new ManifestInvalid({ spec, reason: "manifest.capabilities must declare at least one capability" })
  }

  return {
    id: raw.id,
    version: raw.version,
    kind: raw.kind,
    capabilities: raw.capabilities as Capability[],
    hostRequirements: (raw.hostRequirements ?? undefined) as HostRequirements | undefined,
    permissions: (raw.permissions ?? undefined) as Permissions | undefined,
  }
}

/** Whether a module looks like a v2 plugin. Requirement 11's discriminator. */
export function hasManifest(value: unknown): boolean {
  return typeof value === "object" && value !== null && "manifest" in (value as Record<string, unknown>)
}
