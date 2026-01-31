import type { QueuedOperation } from "../types"
import { getItem, setItem, STORAGE_KEYS } from "./storage"

const MAX_QUEUE_SIZE = 100

export class OfflineQueue {
  private queue: QueuedOperation[] = []

  constructor() {
    this.load()
  }

  private load(): void {
    this.queue = getItem<QueuedOperation[]>(STORAGE_KEYS.OFFLINE_QUEUE, [])
  }

  private save(): void {
    setItem(STORAGE_KEYS.OFFLINE_QUEUE, this.queue)
  }

  enqueue(operation: Omit<QueuedOperation, "id" | "timestamp" | "retryCount">): void {
    const op: QueuedOperation = {
      ...operation,
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      retryCount: 0,
    }

    this.queue.push(op)

    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.shift()
    }

    this.save()
  }

  dequeue(): QueuedOperation | null {
    const op = this.queue.shift()
    if (op) {
      this.save()
    }
    return op ?? null
  }

  peek(): QueuedOperation | null {
    return this.queue[0] ?? null
  }

  getAll(): QueuedOperation[] {
    return [...this.queue]
  }

  clear(): void {
    this.queue = []
    this.save()
  }

  get length(): number {
    return this.queue.length
  }

  incrementRetry(id: string): void {
    const op = this.queue.find((o) => o.id === id)
    if (op) {
      op.retryCount++
      this.save()
    }
  }

  remove(id: string): void {
    this.queue = this.queue.filter((o) => o.id !== id)
    this.save()
  }
}

export const offlineQueue = new OfflineQueue()
