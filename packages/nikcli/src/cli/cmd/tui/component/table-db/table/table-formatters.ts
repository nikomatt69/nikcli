export const TableFormatters = {
  date(value: Date | string, format: "short" | "long" = "short"): string {
    if (value === null || value === undefined) return "-"

    const date = typeof value === "string" ? new Date(value) : value

    if (isNaN(date.getTime())) return String(value)

    if (format === "short") {
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    }

    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  },

  time(value: Date | string | number, format: "short" | "long" = "short"): string {
    if (value === null || value === undefined) return "-"

    let date: Date

    if (typeof value === "number") {
      date = new Date(value)
    } else if (typeof value === "string") {
      date = new Date(value)
    } else {
      date = value
    }

    if (isNaN(date.getTime())) return String(value)

    if (format === "short") {
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    }

    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  },

  number(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
    if (value === null || value === undefined) return "-"
    return new Intl.NumberFormat("en-US", options).format(value)
  },

  currency(value: number | null | undefined, currency: string = "USD"): string {
    if (value === null || value === undefined) return "-"
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(value)
  },

  percent(value: number | null | undefined, decimals: number = 0): string {
    if (value === null || value === undefined) return "-"
    return `${value.toFixed(decimals)}%`
  },

  boolean(value: boolean | null | undefined, trueText: string = "✓", falseText: string = " "): string {
    if (value === null || value === undefined) return "-"
    return value ? trueText : falseText
  },

  yesno(value: boolean | null | undefined): string {
    if (value === null || value === undefined) return "-"
    return value ? "Yes" : "No"
  },

  onoff(value: boolean | null | undefined): string {
    if (value === null || value === undefined) return "-"
    return value ? "On" : "Off"
  },

  truncate(value: any, maxLength: number, ellipsis: string = "…"): string {
    if (value === null || value === undefined) return "-"
    const str = String(value)
    if (str.length <= maxLength) return str
    return str.slice(0, maxLength - 1) + ellipsis
  },

  null(value: any, placeholder: string = "-"): string {
    return value === null || value === undefined ? placeholder : String(value)
  },

  default(value: any, defaultValue: string = "-"): string {
    return value === null || value === undefined || value === "" ? defaultValue : String(value)
  },

  upper(value: any): string {
    return value === null || value === undefined ? "-" : String(value).toUpperCase()
  },

  lower(value: any): string {
    return value === null || value === undefined ? "-" : String(value).toLowerCase()
  },

  title(value: any): string {
    if (value === null || value === undefined) return "-"
    return String(value)
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ")
  },

  bytes(value: number | null | undefined): string {
    if (value === null || value === undefined) return "-"

    const units = ["B", "KB", "MB", "GB", "TB"]
    let unitIndex = 0
    let size = value

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
  },

  duration(value: number | null | undefined): string {
    if (value === null || value === undefined) return "-"

    const seconds = Math.floor(value / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  },

  relativeTime(value: Date | string | number): string {
    if (value === null || value === undefined) return "-"

    const date = typeof value === "number" ? new Date(value) : new Date(value)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffSec < 0) return "future"
    if (diffSec < 60) return "just now"
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHour < 24) return `${diffHour}h ago`
    if (diffDay < 7) return `${diffDay}d ago`
    if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`

    return date.toLocaleDateString()
  },

  json(value: any, indent: number = 2): string {
    if (value === null || value === undefined) return "-"
    if (typeof value === "string") {
      try {
        value = JSON.parse(value)
      } catch {
        return value
      }
    }
    return JSON.stringify(value, null, indent)
  },

  array(value: any[] | null | undefined, separator: string = ", "): string {
    if (value === null || value === undefined) return "-"
    if (!Array.isArray(value)) return String(value)
    return value.map(String).join(separator)
  },

  enum<T extends string>(value: T | null | undefined, mapping: Record<T, string>): string {
    if (value === null || value === undefined) return "-"
    return mapping[value] || String(value)
  },
}
