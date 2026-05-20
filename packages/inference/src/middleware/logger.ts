import { loadEnv } from "../config/env"

type Level = "debug" | "info" | "warn" | "error"
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export interface LogFields {
  [key: string]: unknown
}

class Logger {
  private threshold: number

  constructor(level: Level = "info") {
    this.threshold = ORDER[level]
  }

  setLevel(level: Level) {
    this.threshold = ORDER[level]
  }

  private emit(level: Level, msg: string, fields: LogFields = {}) {
    if (ORDER[level] < this.threshold) return
    const record = { ts: new Date().toISOString(), level, msg, ...fields }
    const line = JSON.stringify(record)
    if (level === "error") console.error(line)
    else if (level === "warn") console.warn(line)
    else console.log(line)
  }

  debug(msg: string, fields?: LogFields) {
    this.emit("debug", msg, fields)
  }
  info(msg: string, fields?: LogFields) {
    this.emit("info", msg, fields)
  }
  warn(msg: string, fields?: LogFields) {
    this.emit("warn", msg, fields)
  }
  error(msg: string, fields?: LogFields) {
    this.emit("error", msg, fields)
  }
}

let logger: Logger | null = null

export function getLogger(): Logger {
  if (logger) return logger
  try {
    const env = loadEnv()
    logger = new Logger(env.LOG_LEVEL)
  } catch {
    logger = new Logger("info")
  }
  return logger
}

export function requestId(): string {
  return crypto.randomUUID()
}
