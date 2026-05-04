export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []
  private closed = false

  push(item: T) {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(): Promise<T> {
    if (this.closed && this.queue.length === 0) {
      throw new Error("Queue is closed")
    }
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (!this.closed) {
      try {
        yield await this.next()
      } catch {
        break
      }
    }
  }

  close() {
    this.closed = true
    // Resolve any pending promises with a sentinel to unblock consumers
    for (const resolve of this.resolvers) {
      resolve(undefined as any)
    }
    this.resolvers = []
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}

/**
 * Like `work()` but collects and returns results. Returns results in the
 * same order as the input items array.
 */
export async function workMap<T, R>(concurrency: number, items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R | undefined>(items.length)
  const pending = items.map((item, index) => ({ item, index }))
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const entry = pending.pop()
        if (entry === undefined) return
        results[entry.index] = await fn(entry.item)
      }
    }),
  )
  return results as R[]
}
