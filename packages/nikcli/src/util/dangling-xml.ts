/**
 * Strip trailing XML tool-call artifacts that some chat-completion parsers
 * (Qwen3/vLLM, llama.cpp hermes) append after natural-language text as a
 * termination artifact. Only the tail is affected — mid-text occurrences are
 * preserved.
 *
 * Opencode #27984.
 */
const DANGLING_XML_TAIL = /(?:\s*<\/?(?:tool_call|tool_calls|function|parameter|invoke|antml)[^>]*\/?>\s*)+$|\u2420+$/i

export function stripDanglingXmlArtifacts(text: string): string {
  if (!text) return text
  // Fast path: only inspect when the tail looks suspicious.
  const tail = text.slice(-64)
  if (!DANGLING_XML_TAIL.test(tail)) return text
  return text.replace(DANGLING_XML_TAIL, "")
}
