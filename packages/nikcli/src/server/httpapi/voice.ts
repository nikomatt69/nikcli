import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { Effect, Layer, Schema } from "effect"

/**
 * `POST /voice/transcribe` — the recording goes out, the transcript comes back.
 *
 * Declared rather than raw: the payload is one base64 string and the answer is
 * one string, and the caller is the prompt composer, which reaches the server
 * through the generated client.
 *
 * The failure is carried in the body instead of as an HTTP error because every
 * one of them is a sentence the composer shows verbatim — "credits required",
 * "no transcript returned", "API key not configured" — and none changes what
 * the client does next.
 */
export namespace VoiceHttpApi {
  const Input = Schema.Struct({
    audio: Schema.String,
    format: Schema.optional(Schema.String),
  }).annotate({ identifier: "VoiceTranscribeInput" })

  const Result = Schema.Struct({
    transcript: Schema.String,
    error: Schema.optional(Schema.String),
  }).annotate({ identifier: "VoiceTranscribeResult" })

  const fromPromise = <A>(fn: () => Promise<A>) => Effect.promise(fn).pipe(Effect.orDie)

  export const Group = HttpApiGroup.make("voice")
    .add(HttpApiEndpoint.post("transcribe", "/transcribe", { payload: Input, success: Result }))
    .prefix("/voice")

  export const Api = HttpApi.make("nikcli").add(Group)
  export const ApiLive = HttpApiBuilder.layer(Api)

  export const handlers = {
    transcribe: ({ payload }: { payload: typeof Input.Type }) =>
      fromPromise(async () => {
        // Lazily imported: the provider credential chain should not load in a
        // process that never transcribes.
        const { VoiceTranscribe } = await import("@/voice/transcribe")
        try {
          return { transcript: await VoiceTranscribe.run(payload) }
        } catch (cause) {
          return { transcript: "", error: cause instanceof Error ? cause.message : String(cause) }
        }
      }),
  }

  export const HandlersLive = HttpApiBuilder.group(Api, "voice", (builder) =>
    builder.handle("transcribe", handlers.transcribe),
  )

  export const layer = ApiLive.pipe(Layer.provide(HandlersLive))
}
