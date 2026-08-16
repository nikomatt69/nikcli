import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"
import { Profile } from "@/profile"

/**
 * The user's declared profile, and the habits nikcli learned alongside it.
 *
 * Both are per-account files the server owns. The terminal's profile dialog used to run
 * `Profile.Service` in-process through `runPromiseWithLayer`, which is the coupling these routes
 * remove; rendering them stays client-side, in `@nikcli-ai/util/profile-render`.
 */
export namespace ProfileHttpApi {
  const Info = Profile.InfoSchema.annotate({ identifier: "ProfileInfo" })

  /** `undefined` is a real answer here: the user may simply not have a profile yet. */
  const MaybeInfo = Schema.NullOr(Info).annotate({ identifier: "ProfileInfoOrNull" })

  /**
   * The editable half of the profile, from the service's own `InputSchema`.
   *
   * Was an open record, so the contract said "any object" while
   * `Profile.Service.patch` accepted exactly `Profile.Input` — the client had no
   * way to know which keys were real, and a typo reached the writer as a field
   * to merge rather than an error.
   */
  const PatchPayload = Profile.InputSchema.annotate({ identifier: "ProfilePatchInput" })

  const Deleted = Schema.Struct({ deleted: Schema.Boolean }).annotate({ identifier: "ProfileDeleted" })

  const Habits = Schema.Struct({ content: Schema.String }).annotate({ identifier: "ProfileHabits" })

  /**
   * The prompt block as the server would inject it, plus the file habits live in.
   *
   * Rendered here rather than in the client on purpose: this is a preview of what actually goes
   * into a request, so it has to come from the code that builds it. A client-side copy would be a
   * second renderer to keep in step with the first.
   */
  const Preview = Schema.Struct({
    lines: Schema.Array(Schema.String),
    habitsFile: Schema.String,
  }).annotate({ identifier: "ProfilePreview" })

  const WorktreeQuery = Schema.Struct({ worktree: Schema.optional(Schema.String) })

  export const Group = HttpApiGroup.make("profile")
    .add(HttpApiEndpoint.get("get", "/", { success: MaybeInfo }))
    .add(HttpApiEndpoint.patch("patch", "/", { payload: PatchPayload, success: Info }))
    .add(HttpApiEndpoint.delete("clear", "/", { success: Deleted }))
    .add(HttpApiEndpoint.get("habits", "/habits", { query: WorktreeQuery, success: Habits }))
    .add(HttpApiEndpoint.get("preview", "/preview", { query: WorktreeQuery, success: Preview }))
    .add(HttpApiEndpoint.delete("clearHabits", "/habits", { query: WorktreeQuery, success: Deleted }))
    .prefix("/profile")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  const run = <A>(effect: Effect.Effect<A, unknown, Profile.Service>) =>
    (effect as Effect.Effect<A, never, Profile.Service>).pipe(
      Effect.provide(Profile.defaultLayer),
      Effect.orDie,
    ) as Effect.Effect<A>

  /** Undefined has to become null: the encoder rejects `undefined` as a JSON value. */
  export const handlers = {
    get: () =>
      run(
        Effect.gen(function* () {
          const profile = yield* Profile.Service
          return (yield* profile.get()) ?? null
        }),
      ),
    // The decoded payload is deeply readonly; `Profile.Input` is the mutable
    // view the writer merges into. Same fields either way — the cast drops
    // `readonly`, not type information, which is why it is not `as unknown as`.
    patch: ({ payload }: { payload: Schema.Schema.Type<typeof Profile.InputSchema> }) =>
      run(
        Effect.gen(function* () {
          const profile = yield* Profile.Service
          return yield* profile.patch(payload as Profile.Input)
        }),
      ),
    clear: () =>
      run(
        Effect.gen(function* () {
          const profile = yield* Profile.Service
          return { deleted: yield* profile.clear() }
        }),
      ),
    habits: ({ query }: { query: { worktree?: string } }) =>
      run(
        Effect.gen(function* () {
          const profile = yield* Profile.Service
          return { content: yield* profile.habits(query.worktree ?? process.cwd()) }
        }),
      ),
    preview: ({ query }: { query: { worktree?: string } }) =>
      run(
        Effect.gen(function* () {
          const profile = yield* Profile.Service
          const worktree = query.worktree ?? process.cwd()
          const info = yield* profile.get()
          const habits = yield* profile.habits(worktree)
          return {
            lines: [
              ...(info ? Profile.render(info) : []),
              ...(info?.habits === false ? [] : Profile.renderHabits(habits)),
            ],
            habitsFile: Profile.habitsFile(worktree),
          }
        }),
      ),
    clearHabits: ({ query }: { query: { worktree?: string } }) =>
      run(
        Effect.gen(function* () {
          const profile = yield* Profile.Service
          return { deleted: yield* profile.clearHabits(query.worktree ?? process.cwd()) }
        }),
      ),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "profile", (builder) =>
    builder
      .handle("get", () => handlers.get())
      .handle("patch", (request) => handlers.patch(request))
      .handle("clear", () => handlers.clear())
      .handle("habits", (request) => handlers.habits(request))
      .handle("preview", (request) => handlers.preview(request))
      .handle("clearHabits", (request) => handlers.clearHabits(request)),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
