// Tiny debounced JSON-on-disk store keyed by string.
// Used by channel-memory and channel-tools to persist per-channel state
// across restarts, mirroring the session persistence in index.ts.

export class JsonStore<T> {
  private map = new Map<string, T>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly file: string,
    private readonly debounceMs = 2000,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await Bun.file(this.file).text()
      const parsed = JSON.parse(raw) as Record<string, T>
      for (const [k, v] of Object.entries(parsed)) this.map.set(k, v)
    } catch {
      // file doesn't exist yet — fresh start
    }
  }

  get(key: string): T | undefined {
    return this.map.get(key)
  }

  entries(): IterableIterator<[string, T]> {
    return this.map.entries()
  }

  set(key: string, value: T): void {
    this.map.set(key, value)
    this.schedulePersist()
  }

  delete(key: string): boolean {
    const existed = this.map.delete(key)
    if (existed) this.schedulePersist()
    return existed
  }

  private schedulePersist(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.persist()
    }, this.debounceMs)
  }

  async persist(): Promise<void> {
    try {
      const obj: Record<string, T> = {}
      for (const [k, v] of this.map.entries()) obj[k] = v
      await Bun.write(this.file, JSON.stringify(obj))
    } catch (err) {
      console.error(`Failed to persist ${this.file}:`, err)
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.persist()
  }
}
