export type CircuitState = "closed" | "open" | "half_open"

export interface CircuitConfig {
  failureThreshold: number
  resetAfterMs: number
  halfOpenProbes: number
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  resetAfterMs: 30_000,
  halfOpenProbes: 1,
}

/**
 * Per-provider circuit breaker. After N consecutive failures the breaker
 * opens and `allow()` returns false until resetAfterMs has elapsed, at which
 * point we let a small number of probe requests through (half-open). On
 * probe success the breaker closes; on probe failure it re-opens.
 */
export class CircuitBreaker {
  private failures = 0
  private openedAt: number | null = null
  private inflightProbes = 0
  private readonly config: CircuitConfig

  constructor(
    public readonly name: string,
    config: Partial<CircuitConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  state(): CircuitState {
    if (this.openedAt === null) return "closed"
    if (Date.now() - this.openedAt >= this.config.resetAfterMs) return "half_open"
    return "open"
  }

  allow(): boolean {
    const s = this.state()
    if (s === "closed") return true
    if (s === "open") return false
    if (this.inflightProbes >= this.config.halfOpenProbes) return false
    this.inflightProbes++
    return true
  }

  recordSuccess() {
    this.failures = 0
    this.openedAt = null
    this.inflightProbes = 0
  }

  recordFailure() {
    if (this.state() === "half_open") {
      this.openedAt = Date.now()
      this.inflightProbes = 0
      return
    }
    this.failures++
    if (this.failures >= this.config.failureThreshold) {
      this.openedAt = Date.now()
    }
  }

  snapshot() {
    return { name: this.name, state: this.state(), failures: this.failures, openedAt: this.openedAt }
  }
}
