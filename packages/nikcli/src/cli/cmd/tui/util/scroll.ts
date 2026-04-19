import type { TuiConfig } from "@/config/tui"

export interface ScrollAcceleration {
  tick(now?: number): number
  reset(): void
}

export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

class MacOSLikeAccel implements ScrollAcceleration {
  private last = 0
  private momentum = 1

  tick(now = performance.now()): number {
    const delta = now - this.last
    this.last = now
    if (delta < 50) this.momentum = Math.min(this.momentum + 0.5, 8)
    else if (delta < 120) this.momentum = Math.max(this.momentum, 2)
    else this.momentum = 1
    return this.momentum
  }

  reset(): void {
    this.momentum = 1
    this.last = 0
  }
}

export function getScrollAcceleration(tuiConfig?: TuiConfig.Info): ScrollAcceleration {
  if (tuiConfig?.scroll_acceleration?.enabled) {
    return new MacOSLikeAccel()
  }
  if (tuiConfig?.scroll_speed !== undefined) {
    return new CustomSpeedScroll(tuiConfig.scroll_speed)
  }

  return new CustomSpeedScroll(3)
}
