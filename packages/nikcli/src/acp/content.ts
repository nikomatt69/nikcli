import path from "node:path"
import { pathToFileURL } from "node:url"
import type {
  BlobResourceContents,
  ContentBlock,
  ContentChunk,
  ResourceLink,
  Role,
  TextResourceContents,
} from "@agentclientprotocol/sdk"

/**
 * Bidirectional conversion between ACP `ContentBlock`s and the internal
 * `PromptPart` shapes that nikcli uses when feeding `session/prompt`.
 *
 * The boundary is intentionally lossless:
 * - text annotations are encoded as `{ synthetic, ignored }` flags so we can
 *   preserve `audience: ["assistant"]` / `audience: ["user"]` round-trips;
 * - image blocks become `data:` URLs so we don't depend on the file system;
 * - resource_link blocks with a `file://` URI flow through as `file` parts;
 * - `zed://` resource links (Zed editor convention) are converted to
 *   `file://` so nikcli can open them locally;
 * - resource blocks are decoded for `text/*` MIME types, kept as base64
 *   blobs for binary types.
 */

export type PromptPart =
  | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
  | { type: "file"; url: string; mime: string; filename?: string }

export type ReplayPart =
  | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
  | {
      type: "file"
      url: string
      mime: string
      filename?: string
    }
  | { type: "reasoning"; text: string }

/**
 * Top-level conversion: a list of `ContentBlock`s from an ACP prompt →
 * a flat list of `PromptPart`s for nikcli's session layer.
 */
export function promptContentToParts(content: ReadonlyArray<ContentBlock>): PromptPart[] {
  return content.flatMap(contentBlockToParts)
}

/**
 * Convert a single ACP content block to one or more nikcli prompt parts.
 *
 * Returns an empty array for blocks we cannot represent (audio blocks for
 * now); the service layer treats an empty conversion as a no-op so unknown
 * block kinds degrade gracefully.
 */
export function contentBlockToParts(block: ContentBlock): PromptPart[] {
  switch (block.type) {
    case "text":
      return [
        {
          type: "text",
          text: block.text,
          ...audienceFlags(block.annotations?.audience ?? undefined),
        },
      ]

    case "image":
      if (block.data) {
        return [
          {
            type: "file",
            url: `data:${block.mimeType};base64,${block.data}`,
            filename: filenameFromUri(block.uri ?? undefined) ?? "image",
            mime: block.mimeType,
          },
        ]
      }
      if (block.uri?.startsWith("data:")) {
        return [
          {
            type: "file",
            url: block.uri,
            filename: filenameFromUri(block.uri) ?? "image",
            mime: block.mimeType,
          },
        ]
      }
      if (block.uri?.startsWith("http://") || block.uri?.startsWith("https://")) {
        return [
          {
            type: "file",
            url: block.uri,
            filename: filenameFromUri(block.uri) ?? "image",
            mime: block.mimeType,
          },
        ]
      }
      return []

    case "resource_link":
      return [resourceLinkToPart(block)]

    case "resource": {
      const resource = block.resource
      if ("text" in resource && resource.text) {
        return [{ type: "text", text: resource.text }]
      }
      if (resource.mimeType && "blob" in resource && resource.blob) {
        return [
          {
            type: "file",
            url: resource.uri.startsWith("data:") ? resource.uri : `data:${resource.mimeType};base64,${resource.blob}`,
            filename: filenameFromUri(resource.uri) ?? "file",
            mime: resource.mimeType,
          },
        ]
      }
      return []
    }

    default:
      return []
  }
}

/**
 * Replay conversion: a list of stored `ReplayPart`s → a list of
 * `ContentChunk`s we can stream back to a client that opened a saved
 * session via `session/load` or `session/resume`.
 */
export function partsToContentChunks(parts: ReadonlyArray<ReplayPart>): ContentChunk[] {
  return parts.flatMap(partToContentChunks)
}

/**
 * Convert a single replay part into one or more `ContentChunk`s.
 *
 * - Text parts emit one chunk with the appropriate `audience` annotation.
 * - Reasoning parts emit a plain text chunk; reasoning should be addressed
 *   to the user.
 * - File parts dispatch through `filePartToContentChunks` which chooses
 *   between `resource_link`, `image`, and `resource` payloads.
 */
export function partToContentChunks(part: ReplayPart): ContentChunk[] {
  switch (part.type) {
    case "text":
      if (!part.text) return []
      return [
        {
          content: {
            type: "text",
            text: part.text,
            ...partAudience(part),
          },
        },
      ]

    case "file":
      return filePartToContentChunks(part)

    case "reasoning":
      if (!part.text) return []
      return [
        {
          content: {
            type: "text",
            text: part.text,
          },
        },
      ]
  }
}

function resourceLinkToPart(link: ResourceLink): PromptPart {
  const parsed = uriToFilePart(link.uri, link.mimeType ?? "text/plain", link.name)
  if (parsed.type === "file") return parsed
  return { type: "text", text: parsed.text }
}

function uriToFilePart(uri: string, mime: string, filename?: string): PromptPart {
  try {
    if (uri.startsWith("file://")) {
      return {
        type: "file",
        url: uri,
        filename: filename ?? filenameFromUri(uri) ?? "file",
        mime,
      }
    }
    if (uri.startsWith("zed://")) {
      const pathname = new URL(uri).searchParams.get("path")
      if (pathname) {
        return {
          type: "file",
          url: pathToFileURL(pathname).href,
          filename: filename ?? (path.basename(pathname) || "file"),
          mime,
        }
      }
    }
    return { type: "text", text: uri }
  } catch {
    return { type: "text", text: uri }
  }
}

function filePartToContentChunks(part: Extract<ReplayPart, { type: "file" }>): ContentChunk[] {
  if (part.url.startsWith("file://")) {
    return [
      {
        content: {
          type: "resource_link",
          uri: part.url,
          name: part.filename ?? "file",
          mimeType: part.mime,
        },
      },
    ]
  }
  if (!part.url.startsWith("data:")) return []

  const data = decodeDataUrl(part.url)
  if (!data) return []
  if (data.mime.startsWith("image/")) {
    return [
      {
        content: {
          type: "image",
          mimeType: data.mime,
          data: data.base64,
          uri: pathToFileURL(part.filename ?? "image").href,
        },
      },
    ]
  }

  // Text-style data URLs decode to a `TextResourceContents`; everything
  // else stays as a `BlobResourceContents` with the raw base64.
  if (data.mime.startsWith("text/") || data.mime === "application/json") {
    const text: TextResourceContents = {
      uri: pathToFileURL(part.filename ?? "file").href,
      mimeType: data.mime,
      text: Buffer.from(data.base64, "base64").toString("utf8"),
    }
    return [
      {
        content: {
          type: "resource",
          resource: text,
        },
      },
    ]
  }

  const blob: BlobResourceContents = {
    uri: pathToFileURL(part.filename ?? "file").href,
    mimeType: data.mime,
    blob: data.base64,
  }
  return [
    {
      content: {
        type: "resource",
        resource: blob,
      },
    },
  ]
}

function decodeDataUrl(url: string): { mime: string; base64: string } | undefined {
  const match = /^data:([^;]+);base64,(.*)$/.exec(url)
  if (!match) return undefined
  return { mime: match[1], base64: match[2] }
}

/**
 * Translate an ACP `audience` annotation into the nikcli `{synthetic,
 * ignored}` flags used when persisting the part. We only set the flags for
 * a single-element audience so non-trivial multi-audience annotations
 * (uncommon in the wild) fall through as a normal user-facing message.
 */
function audienceFlags(audience: ReadonlyArray<Role> | null | undefined): {
  synthetic?: boolean
  ignored?: boolean
} {
  if (audience?.length === 1 && audience[0] === "assistant") return { synthetic: true }
  if (audience?.length === 1 && audience[0] === "user") return { ignored: true }
  return {}
}

function partAudience(part: Extract<ReplayPart, { type: "text" }>): { annotations?: { audience: Role[] } } {
  const audience: Role[] | undefined = part.synthetic ? ["assistant"] : part.ignored ? ["user"] : undefined
  if (!audience) return {}
  return { annotations: { audience } }
}

/**
 * Best-effort filename extraction from a URI. Used as the fallback when a
 * `resource_link` does not declare `name`. Returns `undefined` when the
 * URL is data: or malformed.
 */
function filenameFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined
  if (uri.startsWith("data:")) return undefined
  try {
    const parsed = new URL(uri)
    const name = path.basename(parsed.pathname)
    return name || undefined
  } catch {
    return path.basename(uri) || undefined
  }
}

// Public exports mirror opencode's `content.ts` for easy grep parity.
export const toPromptParts = promptContentToParts
export const fromReplayParts = partsToContentChunks

export * as ACPContent from "./content"
