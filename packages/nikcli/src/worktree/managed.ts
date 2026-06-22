import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Git } from "@/git"
import { Log } from "@/util/log"
import { Lock } from "@/util/lock"
import { zodObject } from "@/util/effect-zod"
import { InstanceState, type InstanceContext } from "@/effect"
import { Context, Effect, Layer, Schema } from "effect"
import { ulid } from "ulid"

export namespace ManagedWorktree {
  const log = Log.create({ service: "managed-worktree" })

  // ULID-based ID type
  export type ID = string

  // Error types
  export class WorktreeError extends Schema.TaggedErrorClass<WorktreeError>()("ManagedWorktreeError", {
    message: Schema.String,
    code: Schema.optional(Schema.String),
  }) {}

  export class UnsafeGitError extends WorktreeError {}
  export class CopyError extends WorktreeError {}
  export class MarkerError extends WorktreeError {}

  // Registry record stored in JSON
  interface RegistryRecord {
    id: ID
    parent_id: ID | null
    path: string
    created_at: number
  }

  // Info returned by API
  export const InfoSchema = Schema.Struct({
    id: Schema.String,
    parentId: Schema.optional(Schema.NullOr(Schema.String)),
    name: Schema.String,
    branch: Schema.String,
    directory: Schema.String,
    createdAt: Schema.Number,
  }).annotate({ identifier: "ManagedWorktreeInfo" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  // Input types
  export const CreateInputSchema = Schema.Struct({
    from: Schema.String,
    name: Schema.optional(Schema.String),
    into: Schema.optional(Schema.String),
  }).annotate({ identifier: "ManagedWorktreeCreateInput" })
  export const CreateInput = zodObject(CreateInputSchema)

  export const RemoveInputSchema = Schema.Struct({
    at: Schema.String,
  }).annotate({ identifier: "ManagedWorktreeRemoveInput" })
  export const RemoveInput = zodObject(RemoveInputSchema)

  export const LinkInputSchema = Schema.Struct({
    at: Schema.String,
    to: Schema.optional(Schema.String),
  }).annotate({ identifier: "ManagedWorktreeLinkInput" })
  export const LinkInput = zodObject(LinkInputSchema)

  export const ChildrenInputSchema = Schema.Struct({
    of: Schema.String,
  }).annotate({ identifier: "ManagedWorktreeChildrenInput" })
  export const ChildrenInput = zodObject(ChildrenInputSchema)

  export const AncestorsInputSchema = Schema.Struct({
    of: Schema.String,
  }).annotate({ identifier: "ManagedWorktreeAncestorsInput" })
  export const AncestorsInput = zodObject(AncestorsInputSchema)

  // Constants
  const WORKTREE_MARKER = ".worktree"
  const DEFAULT_WORKTREE_DIR = ".worktrees"

  // ──────────────────────────────────────────────────────────────────────────
  // Copy Strategy (inspired by opencode's CowStrategy)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Cross-platform copy-on-write strategy.
   * Unlike opencode, we fall back to fs.cp on copy failure since
   * we're in a TypeScript environment and byte-copying is acceptable.
   */
  async function runCopyCommand(command: string, args: string[]) {
    try {
      const proc = Bun.spawn([command, ...args], {
        stdout: "ignore",
        stderr: "pipe",
      })
      const [exitCode, stderr] = await Promise.all([
        proc.exited.catch(() => 1),
        new Response(proc.stderr).text().catch(() => ""),
      ])
      return { exitCode, stderr, ok: exitCode === 0 }
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error)
      return { exitCode: 1, stderr, ok: false }
    }
  }

  async function copyDirectory(src: string, dest: string): Promise<void> {
    const platform = process.platform

    if (platform === "darwin") {
      // macOS: Use clonefile for APFS copy-on-write
      const result = await runCopyCommand("clonefile", [src, dest])
      if (result.ok) {
        log.debug("clonefile success", { src, dest })
        return
      }
      log.warn("clonefile failed, trying fs.cp", {
        src,
        dest,
        exitCode: result.exitCode,
        stderr: result.stderr,
      })
    }

    if (platform === "linux") {
      // Linux: Try reflink via cp --reflink=auto
      const result = await runCopyCommand("cp", ["--reflink=auto", "-a", src, dest])
      if (result.ok) {
        log.debug("reflink copy success", { src, dest })
        return
      }
      log.warn("reflink failed, trying fs.cp", {
        src,
        dest,
        exitCode: result.exitCode,
        stderr: result.stderr,
      })
    }

    // Generic fallback: recursive copy with timestamps preserved
    await fs.cp(src, dest, {
      preserveTimestamps: true,
      recursive: true,
      filter: (src, dest) => {
        // Skip .worktree files during copy - will be written fresh
        if (path.basename(src) === WORKTREE_MARKER) return false
        return true
      },
    })
    log.debug("fs.cp fallback success", { src, dest })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Git Integration (inspired by opencode's git.rs)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Check if git source is safe to copy.
   * Refuses creation from unsafe states like merges, rebases, etc.
   */
  async function checkGitSource(gitDir: string): Promise<boolean> {
    const unsafeStates = [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "BISECT_LOG",
      "rebase-merge",
      "rebase-apply",
      "index.lock",
      "HEAD.lock",
    ]

    for (const state of unsafeStates) {
      const statePath = path.join(gitDir, state)
      try {
        await fs.access(statePath)
        log.warn("Unsafe git state detected", { path: statePath })
        return false
      } catch {
        // File doesn't exist, continue
      }
    }

    return true
  }

  /**
   * Hide .worktree marker from git (add to .git/info/exclude).
   * This ensures the marker doesn't appear in local git status.
   */
  async function hideMarker(repoPath: string): Promise<void> {
    const excludePath = path.join(repoPath, ".git", "info", "exclude")
    const marker = "/.worktree"

    let existing = ""
    try {
      existing = await fs.readFile(excludePath, "utf-8")
    } catch {
      // File doesn't exist yet
    }

    if (existing.includes(marker)) {
      return // Already hidden
    }

    const separator = existing.endsWith("\n") ? "" : "\n"
    await fs.writeFile(excludePath, `${existing}${separator}${marker}\n`)
    log.debug("Marker hidden from git", { repoPath })
  }

  // Write .worktree marker file with ULID
  async function writeMarker(worktreePath: string, id: ID): Promise<void> {
    const markerPath = path.join(worktreePath, WORKTREE_MARKER)
    await fs.writeFile(markerPath, id, "utf-8")
    log.debug("Worktree marker written", { path: markerPath, id })
  }

  // Read .worktree marker file
  async function readMarker(worktreePath: string): Promise<ID | null> {
    const markerPath = path.join(worktreePath, WORKTREE_MARKER)
    try {
      return (await fs.readFile(markerPath, "utf-8")).trim()
    } catch {
      return null
    }
  }

  // Detach HEAD in the copied worktree
  async function detachHead(worktreePath: string): Promise<void> {
    try {
      await Git.run(["switch", "--detach", "--quiet", "HEAD"], {
        cwd: worktreePath,
      })
      log.debug("HEAD detached", { worktreePath })
    } catch (err) {
      log.warn("Failed to detach HEAD", { worktreePath, error: err })
    }
  }

  // Registry file path
  function registryPath(): string {
    return path.join(Global.Path.data, "managed-worktrees", "registry.json")
  }

  // Read registry from JSON file
  async function readRegistry(): Promise<RegistryRecord[]> {
    const file = registryPath()
    try {
      const content = await fs.readFile(file, "utf-8")
      return JSON.parse(content)
    } catch {
      return []
    }
  }

  // Write registry to JSON file
  async function writeRegistry(records: RegistryRecord[]): Promise<void> {
    const filePath = registryPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(records, null, 2), "utf-8")
  }

  // Get registry with lock
  async function withRegistry<T>(fn: (records: RegistryRecord[]) => Promise<T>): Promise<T> {
    using _lock = await Lock.write(`managed-worktree-registry`)
    const records = await readRegistry()
    const result = await fn(records)
    await writeRegistry(records)
    return result
  }

  // Resolve to absolute path
  async function absolutePath(p: string): Promise<string> {
    return path.resolve(p)
  }

  // Check if path exists and is a directory
  async function existingDirectory(p: string): Promise<string> {
    const abs = await absolutePath(p)
    const stat = await fs.stat(abs)
    if (!stat.isDirectory()) {
      throw new WorktreeError({
        message: `Not a directory: ${p}`,
        code: "NOT_DIRECTORY",
      })
    }
    return abs
  }

  // Generate destination name
  function destinationName(inputName: string | undefined, id: ID): string {
    if (inputName) {
      return inputName
    }
    // Generate a short name from ULID timestamp
    const ts = Date.now().toString(36)
    return `wt-${ts.slice(-8)}`
  }

  // Default storage location for worktrees
  function defaultStorage(rootPath: string, workspaceName: string): string {
    return path.join(path.dirname(rootPath), DEFAULT_WORKTREE_DIR, workspaceName)
  }

  // Extract workspace name from path
  function workspaceName(workspacePath: string): string {
    return path.basename(workspacePath)
  }

  // Get root (original) worktree for a given path
  function getRoot(records: RegistryRecord[], sourcePath: string): RegistryRecord | null {
    // Walk up the parent chain to find the root
    for (const record of records) {
      if (record.path === sourcePath) {
        // Check if it has a parent
        if (record.parent_id) {
          const parent = records.find((r) => r.id === record.parent_id)
          if (parent) return getRoot(records, parent.path)
        }
        return record
      }
    }
    // Not found in records, treat as root
    return null
  }

  // Check if a path is inside another
  function isDescendant(targetPath: string, ancestor: string): boolean {
    const rel = path.relative(ancestor, targetPath)
    return !rel.startsWith("..") && !path.isAbsolute(rel)
  }

  // Service interface
  export interface Interface {
    readonly create: (input?: Schema.Schema.Type<typeof CreateInputSchema>) => Effect.Effect<Info>
    readonly remove: (input: Schema.Schema.Type<typeof RemoveInputSchema>) => Effect.Effect<void>
    readonly link: (input: Schema.Schema.Type<typeof LinkInputSchema>) => Effect.Effect<Info>
    readonly children: (input: Schema.Schema.Type<typeof ChildrenInputSchema>) => Effect.Effect<Info[]>
    readonly ancestors: (input: Schema.Schema.Type<typeof AncestorsInputSchema>) => Effect.Effect<Info[]>
    readonly list: () => Effect.Effect<Info[]>
  }

  export class Service extends Context.Service<Service, Interface>()("ManagedWorktree.Service") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      create(input) {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.promise(() => createImpl(ctx, input))
        })
      },
      remove(input: Schema.Schema.Type<typeof RemoveInputSchema>) {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.promise(() => removeImpl(ctx, input))
        })
      },
      link(input: Schema.Schema.Type<typeof LinkInputSchema>) {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.promise(() => linkImpl(ctx, input))
        })
      },
      children(input: Schema.Schema.Type<typeof ChildrenInputSchema>) {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.promise(() => childrenImpl(ctx, input))
        })
      },
      ancestors(input: Schema.Schema.Type<typeof AncestorsInputSchema>) {
        return Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          return yield* Effect.promise(() => ancestorsImpl(ctx, input))
        })
      },
      list() {
        return Effect.gen(function* () {
          return yield* Effect.promise(() => listImpl())
        })
      },
    }),
  )

  export const defaultLayer = layer

  // Implementation
  async function createImpl(ctx: InstanceContext, input?: Schema.Schema.Type<typeof CreateInputSchema>): Promise<Info> {
    if (!input) {
      throw new WorktreeError({
        message: "No input provided",
        code: "INVALID_INPUT",
      })
    }
    const from = await existingDirectory(input.from)
    const gitDir = path.join(from, ".git")

    // Check if it's a git repository
    const isGit = await fs
      .access(gitDir)
      .then(() => true)
      .catch(() => false)
    if (!isGit) {
      throw new WorktreeError({
        message: `Not a git repository: ${from}`,
        code: "NOT_GIT",
      })
    }

    // Safety check: ensure git is not in unsafe state
    const safe = await checkGitSource(gitDir)
    if (!safe) {
      throw new UnsafeGitError({
        message: "Git repository is in an unsafe state (merge, rebase, etc.)",
        code: "UNSAFE_GIT",
      })
    }

    const id = ulid()
    const now = Date.now()

    const info = await withRegistry(async (records) => {
      // Determine source root (original registered workspace)
      const root = getRoot(records, from)
      const parentId = root?.id ?? null

      // Determine destination parent
      let destinationParent: string
      if (input.into) {
        destinationParent = await absolutePath(input.into)
      } else if (root) {
        // Use the root's storage location
        destinationParent = defaultStorage(root.path, workspaceName(root.path))
      } else {
        // New root workspace
        destinationParent = defaultStorage(from, workspaceName(from))
      }

      // Ensure destination parent exists
      await fs.mkdir(destinationParent, { recursive: true })
      destinationParent = await fs.realpath(destinationParent)

      // Determine name and destination
      const name = destinationName(input.name, id)
      const destination = path.join(destinationParent, name)

      // Safety check: don't copy into source
      if (isDescendant(destination, from)) {
        throw new WorktreeError({
          message: "Cannot copy workspace into itself",
          code: "INSIDE_SOURCE",
        })
      }

      // Check destination doesn't exist
      try {
        await fs.access(destination)
        throw new WorktreeError({
          message: `Worktree already exists: ${destination}`,
          code: "ALREADY_EXISTS",
        })
      } catch (err: any) {
        if (err.code !== "ENOENT") throw err
      }

      // Perform copy-on-write
      log.info("Copying workspace", { from, destination })
      await copyDirectory(from, destination)

      try {
        // Hide marker from git
        await hideMarker(destination)

        // Write new marker with new ULID
        await writeMarker(destination, id)

        // Detach HEAD
        await detachHead(destination)

        // Get branch name
        let branch = "detached"
        const branchResult = await Git.run(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: destination })
        if (branchResult.exitCode === 0) {
          branch = branchResult.text().trim()
        }

        // Add to registry
        records.push({
          id,
          parent_id: parentId,
          path: destination,
          created_at: now,
        })

        log.info("Worktree created", { id, path: destination, parentId })

        return {
          id,
          parentId,
          name,
          branch,
          directory: destination,
          createdAt: now,
        }
      } catch (err) {
        // Cleanup on failure
        log.warn("Create failed, cleaning up", { destination, error: err })
        try {
          await fs.rm(destination, { recursive: true, force: true })
        } catch {}
        throw err
      }
    })

    return info
  }

  async function removeImpl(ctx: InstanceContext, input: Schema.Schema.Type<typeof RemoveInputSchema>): Promise<void> {
    const at = await absolutePath(input.at)

    await withRegistry(async (records) => {
      const index = records.findIndex((r) => r.path === at)

      if (index === -1) {
        throw new WorktreeError({
          message: `Worktree not managed: ${at}`,
          code: "NOT_MANAGED",
        })
      }

      const record = records[index]

      // Check if it's a root (original) workspace
      if (!record.parent_id) {
        throw new WorktreeError({
          message: "Cannot remove the original registered workspace",
          code: "CANNOT_REMOVE_ROOT",
        })
      }

      // Verify marker exists
      const markerId = await readMarker(at)
      if (markerId !== record.id) {
        throw new MarkerError({
          message: "Worktree marker does not match registry",
          code: "MARKER_MISMATCH",
        })
      }

      // Get all descendants
      const descendants = getDescendants(records, record.id)
      const allToRemove = [...descendants, record]

      // Remove filesystem entries deepest-first
      for (const item of allToRemove.reverse()) {
        try {
          await fs.rm(item.path, { recursive: true, force: true })
        } catch (err) {
          log.warn("Failed to remove path", { path: item.path, error: err })
        }
      }

      // Remove from registry (also removes descendants due to cascade)
      const idsToRemove = new Set(allToRemove.map((r) => r.id))
      for (const id of idsToRemove) {
        const i = records.findIndex((r) => r.id === id)
        if (i !== -1) records.splice(i, 1)
      }

      log.info("Worktree removed", { id: record.id, path: at })
    })
  }

  function getDescendants(records: RegistryRecord[], parentId: string): RegistryRecord[] {
    const result: RegistryRecord[] = []
    const children = records.filter((r) => r.parent_id === parentId)

    for (const child of children) {
      result.push(child)
      result.push(...getDescendants(records, child.id))
    }

    return result
  }

  async function linkImpl(ctx: InstanceContext, input: Schema.Schema.Type<typeof LinkInputSchema>): Promise<Info> {
    const at = await absolutePath(input.at)

    const info = await withRegistry(async (records) => {
      // Read marker
      const markerId = await readMarker(at)

      let record: RegistryRecord | undefined

      if (!markerId) {
        // Try to find by path
        record = records.find((r) => r.path === at)

        if (!record) {
          throw new MarkerError({
            message: "Worktree marker missing and path not in registry",
            code: "UNKNOWN_MARKER",
          })
        }

        // Recreate marker
        await writeMarker(at, record.id)
      } else {
        // Find record by marker ID
        record = records.find((r) => r.id === markerId)

        if (!record) {
          throw new MarkerError({
            message: "Worktree marker belongs to unknown registry entry",
            code: "UNKNOWN_MARKER",
          })
        }

        // Update path if moved
        if (record.path !== at) {
          try {
            await fs.access(record.path)
            throw new WorktreeError({
              message: "Cannot link to existing path",
              code: "DUPLICATE_PATH",
            })
          } catch (err: any) {
            if (err.code !== "ENOENT") throw err
          }

          record.path = at
          log.info("Worktree path updated", { id: record.id, newPath: at })
        }
      }

      // Handle parent change
      if (input.to) {
        const toPath = await absolutePath(input.to)
        const toRecord = records.find((r) => r.path === toPath)

        if (!toRecord) {
          throw new WorktreeError({
            message: `Parent worktree not managed: ${input.to}`,
            code: "PARENT_NOT_FOUND",
          })
        }

        // Check for cycle
        if (toRecord.id === record!.id || isDescendant(toPath, at)) {
          throw new WorktreeError({
            message: "Cannot create cycle in worktree tree",
            code: "CYCLE",
          })
        }

        // Prevent reparenting original
        if (!record!.parent_id) {
          throw new WorktreeError({
            message: "Cannot reparent the original registered workspace",
            code: "CANNOT_LINK_ROOT",
          })
        }

        record!.parent_id = toRecord.id
        log.info("Worktree reparented", {
          id: record!.id,
          newParent: toRecord.id,
        })
      }

      return await getInfo(record!)
    })

    return info
  }

  async function childrenImpl(
    ctx: InstanceContext,
    input: Schema.Schema.Type<typeof ChildrenInputSchema>,
  ): Promise<Info[]> {
    const of = await absolutePath(input.of)

    const records = await readRegistry()
    const record = records.find((r) => r.path === of)

    if (!record) {
      return []
    }

    const children = records.filter((r) => r.parent_id === record.id)
    return Promise.all(children.map((c) => getInfo(c)))
  }

  async function ancestorsImpl(
    ctx: InstanceContext,
    input: Schema.Schema.Type<typeof AncestorsInputSchema>,
  ): Promise<Info[]> {
    const of = await absolutePath(input.of)

    const records = await readRegistry()
    const record = records.find((r) => r.path === of)

    if (!record) {
      return []
    }

    const result: Info[] = []
    let current = record

    while (current.parent_id) {
      const parent = records.find((r) => r.id === current.parent_id)

      if (!parent) break

      result.push(await getInfo(parent))
      current = parent
    }

    return result
  }

  async function listImpl(): Promise<Info[]> {
    const records = await readRegistry()
    return Promise.all(records.map((r) => getInfo(r)))
  }

  async function getInfo(record: RegistryRecord): Promise<Info> {
    // Get branch
    let branch = "unknown"
    try {
      const result = await Git.run(["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: record.path,
      })
      if (result.exitCode === 0) {
        branch = result.text().trim()
      }
    } catch {}

    return {
      id: record.id,
      parentId: record.parent_id,
      name: workspaceName(record.path),
      branch,
      directory: record.path,
      createdAt: record.created_at,
    }
  }
}
