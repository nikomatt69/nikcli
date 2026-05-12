import { streamText, type StreamTextResult, type ToolSet } from "ai"

export type StreamResult = StreamTextResult<ToolSet, unknown>
export type StreamTextRequest = Parameters<typeof streamText>[0]

export function stream(input: StreamTextRequest): StreamResult {
  return streamText(input)
}

export function suppressNoContentText<T extends Pick<StreamResult, "text">>(result: T): T {
  result.text.catch(() => {})
  return result
}
