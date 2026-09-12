/**
 * Who owns a key event, as data.
 *
 * `specs/effect-tui/07-input-interaction.md` requirement 2 names the order:
 * active modal, focused editable surface, registered route/plugin context,
 * application fallback. Written as a table rather than a chain of `if`s so the
 * order is one thing to read and one thing to change, and so the layers that
 * *lose* are enumerable — a precedence expressed as control flow can only be
 * tested for the cases somebody remembered to write.
 *
 * The rule this exists to enforce is requirement 3's: an input event cannot
 * both close a dialog and cancel a session. That happens when two layers both
 * believe they are entitled to the same event, which is what an implicit
 * precedence produces.
 */

/** The layers that can claim an event, highest precedence first. */
export const INPUT_LAYERS = ["modal", "editable", "route", "application"] as const

export type InputLayer = (typeof INPUT_LAYERS)[number]

/** Which layers are currently able to take an event. */
export type InputLayers = {
  /** A dialog or overlay is open. */
  readonly modal?: boolean
  /** A text input, editor, or other editable surface holds focus. */
  readonly editable?: boolean
  /** The active route or a plugin has registered a handler for this context. */
  readonly route?: boolean
  /** The application fallback. Always present; listed so the table is total. */
  readonly application?: boolean
}

/**
 * The single layer entitled to this event.
 *
 * Returns `undefined` only when nothing is active at all — including the
 * application fallback, which a caller may withhold deliberately (during
 * startup, say) and which is the one case where dropping the event is correct.
 */
export function ownerOf(active: InputLayers): InputLayer | undefined {
  for (const layer of INPUT_LAYERS) {
    if (active[layer]) return layer
  }
  return undefined
}

/**
 * Whether a layer may act on this event.
 *
 * The question every handler should ask before doing anything, instead of
 * checking the conditions it happens to know about. A handler that asks "is a
 * modal open" is guessing at the table; one that asks "am I the owner" is
 * reading it.
 */
export function owns(layer: InputLayer, active: InputLayers): boolean {
  return ownerOf(active) === layer
}

/**
 * The layers that were superseded, for diagnostics.
 *
 * When two handlers both fire on one event the useful question is which one
 * should not have, and that is this list.
 */
export function superseded(active: InputLayers): InputLayer[] {
  const owner = ownerOf(active)
  if (!owner) return []
  return INPUT_LAYERS.filter((layer) => layer !== owner && Boolean(active[layer]))
}
