type Pending<T> = Promise<T>

export class Coalescer<T> {
  private readonly inflight = new Map<string, Pending<T>>()

  async run(key: string, fn: () => Promise<T>): Promise<{ value: T; coalesced: boolean }> {
    const existing = this.inflight.get(key)
    if (existing) {
      const value = await existing
      return { value, coalesced: true }
    }
    const promise = fn().finally(() => {
      this.inflight.delete(key)
    })
    this.inflight.set(key, promise)
    const value = await promise
    return { value, coalesced: false }
  }

  size() {
    return this.inflight.size
  }
}
