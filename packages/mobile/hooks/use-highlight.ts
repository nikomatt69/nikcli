import { useMemo } from "react"
import { highlightCode, type HighlightSegment } from "@/lib/highlight"

export function useHighlightedCode(code: string): HighlightSegment[] {
  return useMemo(() => highlightCode(code), [code])
}
