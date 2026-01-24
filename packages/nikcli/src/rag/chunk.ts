export type RagChunk = {
  id: string
  file: string
  start: number
  end: number
  text: string
}

export type RagChunkResult = {
  chunks: RagChunk[]
  truncated: boolean
}

export function chunkText(input: {
  file: string
  text: string
  chunkLines: number
  maxChunks: number
}): RagChunkResult {
  const lines = input.text.split("\n")
  const total = Math.ceil(lines.length / input.chunkLines)
  const starts = Array.from({ length: total }, (_, index) => index * input.chunkLines)
  const chunks = [] as RagChunk[]

  for (const start of starts) {
    if (chunks.length >= input.maxChunks) break
    const end = Math.min(lines.length, start + input.chunkLines)
    const text = lines.slice(start, end).join("\n")
    const hash = Bun.hash.xxHash32(`${input.file}:${start + 1}:${end}`)
    chunks.push({
      id: `chunk_${hash}`,
      file: input.file,
      start: start + 1,
      end,
      text,
    })
  }

  return {
    chunks,
    truncated: chunks.length < total,
  }
}
