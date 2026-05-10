import v8 from "v8"
import z from "zod"
import { Log } from "@/util/log"

const log = Log.create({ service: "heap" })

export const HeapMetricsSchema = z.object({
  rss: z.number(),
  heapTotal: z.number(),
  heapUsed: z.number(),
  external: z.number(),
  arrayBuffers: z.number(),
  heapLimit: z.number(),
  mallocedMemory: z.number(),
  peakMallocedMemory: z.number(),
  totalAvailableSize: z.number(),
  totalHeapSize: z.number(),
  totalHeapSizeExecutable: z.number(),
  totalPhysicalSize: z.number(),
  totalGlobalHandles: z.number(),
  usedGlobalHandles: z.number(),
})

export type HeapMetrics = z.infer<typeof HeapMetricsSchema>

export const HeapMetricKeySchema = HeapMetricsSchema.keyof()

export namespace Heap {
  export type Metrics = HeapMetrics

  export const DEFAULT_FORMAT = ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"] as const

  export function metrics(): Metrics {
    try {
      const mem = process.memoryUsage()
      const heap = v8.getHeapStatistics()

      const result: Metrics = {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
        heapLimit: heap.heap_size_limit,
        mallocedMemory: heap.malloced_memory,
        peakMallocedMemory: heap.peak_malloced_memory,
        totalAvailableSize: heap.total_available_size,
        totalHeapSize: heap.total_heap_size,
        totalHeapSizeExecutable: heap.total_heap_size_executable,
        totalPhysicalSize: heap.total_physical_size,
        totalGlobalHandles: heap.total_global_handles_size,
        usedGlobalHandles: heap.used_global_handles_size,
      }

      log.debug("Heap metrics collected", { heapUsed: result.heapUsed, heapTotal: result.heapTotal })
      return result
    } catch (error) {
      log.error("Failed to collect heap metrics", { error })
      return {
        rss: 0,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0,
        heapLimit: 0,
        mallocedMemory: 0,
        peakMallocedMemory: 0,
        totalAvailableSize: 0,
        totalHeapSize: 0,
        totalHeapSizeExecutable: 0,
        totalPhysicalSize: 0,
        totalGlobalHandles: 0,
        usedGlobalHandles: 0,
      }
    }
  }

  export function formatMetric(bytes: number): string {
    if (!Number.isFinite(bytes)) return "n/a"
    const units = ["B", "KB", "MB", "GB"] as const
    let value = bytes
    let index = 0
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024
      index++
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
  }

  export function report(keys: readonly string[] = DEFAULT_FORMAT): string {
    const m = metrics()
    const lines: string[] = []

    for (const key of keys) {
      const validKey = HeapMetricKeySchema.safeParse(key)
      if (!validKey.success) {
        log.warn("Invalid metric key requested", { key })
        continue
      }

      const value = m[validKey.data]
      if (typeof value !== "number") {
        lines.push(`${key}: ${formatMetric(Number.NaN)}`)
        continue
      }
      lines.push(`${key}: ${formatMetric(value)}`)
    }

    return lines.join("\n")
  }
}
