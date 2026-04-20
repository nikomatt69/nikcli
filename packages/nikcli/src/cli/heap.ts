import v8 from "v8"

export namespace Heap {
  export type Metrics = {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
    arrayBuffers: number
    heapLimit: number
    mallocedMemory: number
    peakMallocedMemory: number
    totalAvailableSize: number
    totalHeapSize: number
    totalHeapSizeExecutable: number
    totalPhysicalSize: number
    totalGlobalHandles: number
    usedGlobalHandles: number
  }

  export const DEFAULT_FORMAT = ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"] as const

  export function metrics(): Metrics {
    const mem = process.memoryUsage()
    const heap = v8.getHeapStatistics()

    return {
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
  }

  export function formatMetric(bytes: number): string {
    if (Number.isNaN(bytes)) return "n/a"
    const units = ["B", "KB", "MB", "GB"]
    let value = bytes
    let index = 0
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024
      index++
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
  }

  export function report(keys: readonly string[] = DEFAULT_FORMAT) {
    const m = metrics()
    const lines = []
    for (const key of keys) {
      const value = m[key as keyof Metrics]
      lines.push(`${key}: ${formatMetric(typeof value === "number" ? value : Number.NaN)}`)
    }
    return lines.join("\n")
  }
}
