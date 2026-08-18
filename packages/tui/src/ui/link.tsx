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
 *
 * The inner `<a href>` is an OpenTUI OSC-8 hyperlink whose target is `href`
 * in full — including query strings such as artifact `?key=` capabilities.
 * Terminal URL autodetection often stops before `?`, so a bare text URL
 * would open the login-gated page even when the visible string has the key.
 * `onMouseUp` still opens the same `href` for terminals without OSC-8.
 */
export function Link(props: LinkProps) {
  return (
    <text
      fg={props.fg}
      attributes={props.underline !== false ? TextAttributes.UNDERLINE : undefined}
      wrapMode="char"
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      <a href={props.href}>{props.children ?? props.href}</a>
    </text>
  )
}
