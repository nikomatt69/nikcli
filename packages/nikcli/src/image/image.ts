import { Context, Effect, Layer, Schema } from "effect"
import { Config } from "@/config/config"
import type { MessageV2 } from "@/session/message-v2"
import { bunUtils } from "@/bun"
import { Log } from "@nikcli-ai/util/log"

export namespace Image {
  const MAX_BASE64_BYTES = 5 * 1024 * 1024
  const MAX_WIDTH = 2000
  const MAX_HEIGHT = 2000
  const AUTO_RESIZE = true
  const JPEG_QUALITIES = [80, 85, 70, 55, 40]
  const log = Log.create({ service: "image" })

  export class ResizerUnavailableError extends Schema.TaggedError<ResizerUnavailableError>()(
    "ImageResizerUnavailableError",
    {},
  ) {
    override get message() {
      return "Image resizer is unavailable"
    }
  }

  export class InvalidDataUrlError extends Schema.TaggedError<InvalidDataUrlError>()("ImageInvalidDataUrlError", {
    url: Schema.String,
  }) {
    override get message() {
      return "Image URL must be a base64 data URL"
    }
  }

  export class DecodeError extends Schema.TaggedError<DecodeError>()("ImageDecodeError", {}) {
    override get message() {
      return "Image could not be decoded"
    }
  }

  export class SizeError extends Schema.TaggedError<SizeError>()("ImageSizeError", {
    bytes: Schema.Number,
    max: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
    max_width: Schema.Number,
    max_height: Schema.Number,
  }) {
    override get message() {
      return `Image ${this.width}x${this.height} with base64 size ${this.bytes} exceeds configured limits and could not be resized below ${this.max_width}x${this.max_height}/${this.max} bytes`
    }
  }

  export type AnyError = ResizerUnavailableError | InvalidDataUrlError | DecodeError | SizeError

  export interface Interface {
    readonly normalize: (input: MessageV2.FilePart) => Effect.Effect<MessageV2.FilePart, AnyError | unknown>
  }

  export class Service extends Context.Service<Service, Interface>()("Image.Service") {}

  function sizes(originalWidth: number, originalHeight: number, maxWidth: number, maxHeight: number) {
    const scale = Math.min(1, maxWidth / originalWidth, maxHeight / originalHeight)
    const result: Array<{ width: number; height: number }> = []
    let width = Math.max(1, Math.round(originalWidth * scale))
    let height = Math.max(1, Math.round(originalHeight * scale))
    for (let i = 0; i < 32; i++) {
      if (result.some((item) => item.width === width && item.height === height)) break
      result.push({ width, height })
      if (width === 1 && height === 1) break
      width = width === 1 ? 1 : Math.max(1, Math.floor(width * 0.75))
      height = height === 1 ? 1 : Math.max(1, Math.floor(height * 0.75))
    }
    return result
  }

  async function encodeCandidate(bytes: Uint8Array, width: number, height: number, maxBase64Bytes: number) {
    for (const quality of JPEG_QUALITIES) {
      const url = await new bunUtils.Image(bytes.slice())
        .resize(width, height, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .dataurl()
      if (Buffer.byteLength(url, "utf8") <= maxBase64Bytes) {
        return { mime: "image/jpeg", url }
      }
    }
    const url = await new bunUtils.Image(bytes.slice())
      .resize(width, height, { fit: "inside", withoutEnlargement: true })
      .png()
      .dataurl()
    if (Buffer.byteLength(url, "utf8") <= maxBase64Bytes) {
      return { mime: "image/png", url }
    }
    return undefined
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service

      const normalize: Interface["normalize"] = (input) =>
        Effect.gen(function* () {
          if (typeof bunUtils.Image !== "function") return yield* new ResizerUnavailableError()

          const image = (yield* config.get()).attachment?.image
          const info = {
            autoResize: image?.auto_resize ?? AUTO_RESIZE,
            maxWidth: image?.max_width ?? MAX_WIDTH,
            maxHeight: image?.max_height ?? MAX_HEIGHT,
            maxBase64Bytes: image?.max_base64_bytes ?? MAX_BASE64_BYTES,
          }
          if (!input.url.startsWith("data:") || !input.url.includes(";base64,"))
            return yield* new InvalidDataUrlError({ url: input.url })

          const base64 = input.url.slice(input.url.indexOf(";base64,") + ";base64,".length)
          const encodedBytes = Buffer.byteLength(base64, "utf8")
          const bytes = Buffer.from(base64, "base64")

          const meta = yield* Effect.tryPromise({
            try: () =>
              new bunUtils.Image(bytes, {
                maxPixels: Math.max(info.maxWidth * info.maxHeight, 4096 * 4096),
              }).metadata(),
            catch: (error) => {
              log.warn("failed to decode image", { error })
              return new DecodeError()
            },
          })

          if (meta.width <= info.maxWidth && meta.height <= info.maxHeight && encodedBytes <= info.maxBase64Bytes) {
            return input
          }
          if (!info.autoResize)
            return yield* new SizeError({
              bytes: encodedBytes,
              max: info.maxBase64Bytes,
              width: meta.width,
              height: meta.height,
              max_width: info.maxWidth,
              max_height: info.maxHeight,
            })

          for (const size of sizes(meta.width, meta.height, info.maxWidth, info.maxHeight)) {
            const candidate = yield* Effect.tryPromise({
              try: () => encodeCandidate(bytes, size.width, size.height, info.maxBase64Bytes),
              catch: (error) => {
                log.warn("failed to resize image", { error })
                return new DecodeError()
              },
            })
            if (!candidate) continue
            log.info("using resized image", {
              from_mime: input.mime,
              to_mime: candidate.mime,
              from: `${meta.width}x${meta.height}`,
              to: `${size.width}x${size.height}`,
            })
            return {
              ...input,
              mime: candidate.mime,
              url: candidate.url,
            }
          }

          return yield* new SizeError({
            bytes: encodedBytes,
            max: info.maxBase64Bytes,
            width: meta.width,
            height: meta.height,
            max_width: info.maxWidth,
            max_height: info.maxHeight,
          })
        })

      return Service.of({ normalize })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))
}
