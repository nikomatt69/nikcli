import type { FilePart, FileSource, TextPart } from "@nikcli-ai/sdk/v2"

/** Paste attachments are not tied to prompt inline ranges; mirror autocomplete placeholder source. */
function fileSourceFromPath(filepath: string): FileSource {
  const text = { value: "", start: 0, end: 0 }
  return { type: "file", path: filepath, text }
}

export type SupportPromptPart =
  | Omit<FilePart, "id" | "messageID" | "sessionID">
  | Omit<TextPart, "id" | "messageID" | "sessionID">

export type SupportAttachment = {
  label: string
  part: Omit<FilePart, "id" | "messageID" | "sessionID">
}

/** Build session.prompt parts: leading text, then file parts (same shape as the main session prompt). */
export function buildSupportPromptParts(text: string, attachments: SupportAttachment[]): SupportPromptPart[] {
  const trimmed = text.trim()
  const parts: SupportPromptPart[] = []
  if (trimmed) parts.push({ type: "text", text: trimmed })
  for (const item of attachments) parts.push(item.part)
  return parts
}

/**
 * Interpret a paste as a workspace file path or image path (mirrors session Prompt paste behavior).
 * Returns null when the paste should be handled as normal text.
 */
export async function supportPartFromPaste(pasted: string): Promise<SupportAttachment | null> {
  const normalized = pasted.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
  if (!normalized || normalized.includes("\n")) return null

  const filepath = normalized.replace(/^'+|'+$/g, "").replace(/\\ /g, " ")
  if (/^(https?):\/\//.test(filepath)) return null

  try {
    const file = Bun.file(filepath)
    const exists = await file.exists()
    if (!exists) return null

    if (file.type === "image/svg+xml") {
      const content = await file.text().catch(() => "")
      if (!content) return null
      const label = `[SVG: ${file.name ?? "image"}]`
      return {
        label,
        part: {
          type: "file",
          mime: file.type,
          filename: file.name,
          url: `data:${file.type};charset=utf-8,${encodeURIComponent(content)}`,
          source: fileSourceFromPath(filepath),
        },
      }
    }

    if (file.type.startsWith("image/")) {
      const content = await file
        .arrayBuffer()
        .then((buffer) => Buffer.from(buffer).toString("base64"))
        .catch(() => "")
      if (!content) return null
      const label = `[Image: ${file.name ?? "file"}]`
      return {
        label,
        part: {
          type: "file",
          mime: file.type,
          filename: file.name,
          url: `data:${file.type};base64,${content}`,
          source: fileSourceFromPath(filepath),
        },
      }
    }

    const text = await file.text().catch(() => "")
    if (!text) return null
    const name = file.name ?? filepath
    const label = `[File: ${name}]`
    return {
      label,
      part: {
        type: "file",
        mime: file.type || "text/plain",
        filename: name,
        url: `data:${file.type || "text/plain"};charset=utf-8,${encodeURIComponent(text)}`,
        source: fileSourceFromPath(filepath),
      },
    }
  } catch {
    return null
  }
}
