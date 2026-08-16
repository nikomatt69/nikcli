/**
 * InputScheduler — coalesces pointer traffic before it reaches the page.
 *
 * A terminal reports mouse motion per cell crossed and wheel notches per tick,
 * and every one of those used to become its own RPC to the daemon and its own
 * CDP round-trip. Dragging across a page produced a queue of moves the browser
 * was still working through after the pointer had stopped, and a fast scroll
 * produced a queue of wheels that kept scrolling after the fingers lifted.
 *
 * The fix is the one a browser's own compositor uses: within a frame, only the
 * *latest* position matters and wheel deltas *add up*. So moves overwrite each
 * other, wheels accumulate into one event, and both flush once per tick.
 *
 * Two orderings are load-bearing:
 *
 *  1. **A press flushes first.** A click means "at wherever the pointer now
 *     is", so a pending move must land before the button goes down, or the page
 *     sees the press at the previous position.
 *  2. **Wheel before move.** Scrolling moves the document under a stationary
 *     pointer; sending the coalesced move first would place hover on content
 *     that the wheel is about to displace.
 */

export type PointerInput = Record<string, unknown> & { readonly type: string }

export interface InputSchedulerOptions {
  /** Where a flushed event goes. */
  readonly send: (input: PointerInput) => void
  /**
   * How long a move or wheel may wait to be joined by its successors. One
   * 60 Hz frame: long enough to swallow a burst, short enough that no one
   * perceives the delay.
   */
  readonly intervalMs?: number
}

export class InputScheduler {
  private readonly send: (input: PointerInput) => void
  private readonly intervalMs: number
  private move: PointerInput | undefined
  private wheel: (PointerInput & { deltaX: number; deltaY: number }) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(options: InputSchedulerOptions) {
    this.send = options.send
    this.intervalMs = options.intervalMs ?? 16
  }

  /**
   * Queue an event. Everything that is not a move or a wheel — presses,
   * releases, keys — goes straight out, after whatever was pending.
   */
  push(input: PointerInput): void {
    if (this.disposed) return
    if (input.type === "move") {
      this.move = input
      this.arm()
      return
    }
    if (input.type === "wheel") {
      const deltaX = Number(input.deltaX ?? 0)
      const deltaY = Number(input.deltaY ?? 0)
      // Position comes from the newest event: the pointer may have drifted a
      // cell while the notches piled up, and the page cares where it is now.
      this.wheel = this.wheel
        ? { ...input, deltaX: this.wheel.deltaX + deltaX, deltaY: this.wheel.deltaY + deltaY }
        : { ...input, deltaX, deltaY }
      this.arm()
      return
    }
    this.flush()
    this.send(input)
  }

  private arm(): void {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, this.intervalMs)
  }

  /** Send whatever is pending, in the order the page expects it. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const wheel = this.wheel
    const move = this.move
    this.wheel = undefined
    this.move = undefined
    if (wheel) this.send(wheel)
    if (move) this.send(move)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.move = undefined
    this.wheel = undefined
  }
}
