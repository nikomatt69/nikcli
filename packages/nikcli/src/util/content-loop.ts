/**
 * Detect "doom loops" in reasoning/text content: when a chunk repeats an
 * earlier block verbatim, we nudge the model to stop and take action.
 *
 * Opencode #21112. The tool-call doom loop in processor.ts was already in
 * nikcli; this adds the analogous check for thinking/output content (Kimi
 * K2.5, GLM-5, and similar models sometimes get stuck in pure-text loops).
 *
 * Algorithm: keep a small ring of recent content blocks (10..2000 chars).
 * When a new block matches the previous block verbatim (after normalize),
 * bump a counter; once the counter hits a threshold, the caller should
 * emit a system reminder. After too many nudges the caller should abort.
 */

const MIN_BLOCK_LENGTH = 10
const MAX_BLOCK_LENGTH = 2000
const RING_SIZE = 4
const REPEAT_THRESHOLD = 1
const MAX_NUDGES = 3

export namespace ContentLoop {
  export type State = {
    ring: string[]
    repeatStreak: number
    nudges: number
  }

  export function initial(): State {
    return { ring: [], repeatStreak: 0, nudges: 0 }
  }

  function normalize(text: string): string {
    return text.replace(/\s+/g, " ").trim()
  }

  /**
   * Check a freshly flushed block (a reasoning-end or text segment).
   * Returns whether the model is in a content loop, along with the
   * recommended action: "ignore", "nudge", or "abort".
   */
  export function check(
    state: State,
    block: string,
  ): {
    looped: boolean
    action: "ignore" | "nudge" | "abort"
    state: State
  } {
    const trimmed = block.trim()
    if (trimmed.length < MIN_BLOCK_LENGTH || trimmed.length > MAX_BLOCK_LENGTH) {
      return { looped: false, action: "ignore", state }
    }
    const key = normalize(trimmed)
    const ring = [...state.ring, key]
    while (ring.length > RING_SIZE) ring.shift()
    if (ring.length >= 2 && ring[ring.length - 1] === ring[ring.length - 2]) {
      const streak = state.repeatStreak + 1
      const nudges = streak >= REPEAT_THRESHOLD ? state.nudges + 1 : state.nudges
      const action: "ignore" | "nudge" | "abort" =
        nudges > MAX_NUDGES ? "abort" : streak >= REPEAT_THRESHOLD ? "nudge" : "ignore"
      return {
        looped: streak >= REPEAT_THRESHOLD,
        action,
        state: { ring, repeatStreak: streak, nudges },
      }
    }
    return {
      looped: false,
      action: "ignore",
      state: { ring, repeatStreak: 0, nudges: state.nudges },
    }
  }
}
