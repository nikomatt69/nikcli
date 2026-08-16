import type { JSX } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { RGBA } from "@opentui/core"
import open from "open"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
  /**
   * Whether to show underline styling (default: true)
   */
  underline?: boolean
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    <text
      fg={props.fg}
      attributes={props.underline !== false ? TextAttributes.UNDERLINE : undefined}
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      {displayText}
    </text>
  )
}
