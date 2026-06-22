import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"
import { lazyAsync } from "@/util/lazy"

interface FileTimeEntry {
  mtime: number
  size: number
  read: number
}

interface SessionFileTimes {
  [filepath: string]: FileTimeEntry
}

export namespace FileTime {
  const log = Log.create({ service: "file.time" })

  export const FileModifiedError = class FileModifiedError extends Error {
    constructor(
      public filepath: string,
      message: string,
    ) {
      super(message)
      this.name = "FileModifiedError"
    }
  }

  export const state = Instance.state(() => {
    const read: {
      [sessionID: string]: {
        [path: string]: FileTimeEntry
      }
    } = {}
    const locks = new Map<string, Promise<void>>()
    return {
      read,
      locks,
    }
  })

  const storage = lazyAsync(async () => {
    const dir = path.join(Global.Path.data, "filetime")
    await fs.mkdir(dir, { recursive: true })
    return { dir }
  })

  async function loadFromStorage(sessionID: string): Promise<SessionFileTimes> {
    const { dir } = await storage()
    const target = path.join(dir, `${sessionID}.json`)
    try {
      return await Bun.file(target).json()
    } catch {
      return {}
    }
  }

  async function saveToStorage(sessionID: string, data: SessionFileTimes): Promise<void> {
    const { dir } = await storage()
    const target = path.join(dir, `${sessionID}.json`)
    await Bun.write(target, JSON.stringify(data, null, 2))
  }

  export async function read(sessionID: string, file: string): Promise<void> {
    log.info("read", { sessionID, file })
    const { read } = state()
    read[sessionID] = read[sessionID] || {}

    try {
      const stats = await Bun.file(file).stat()
      const entry: FileTimeEntry = {
        mtime: stats.mtimeMs,
        size: stats.size,
        read: Date.now(),
      }
      read[sessionID][file] = entry

      const storageData = await loadFromStorage(sessionID)
      storageData[file] = entry
      await saveToStorage(sessionID, storageData)
    } catch (error) {
      log.warn("failed to track file read time", { sessionID, file, error })
    }
  }

  export function get(sessionID: string, file: string): number | undefined {
    return state().read[sessionID]?.[file]?.read
  }

  export async function getEntry(sessionID: string, file: string): Promise<FileTimeEntry | undefined> {
    const memoryEntry = state().read[sessionID]?.[file]
    if (memoryEntry) return memoryEntry

    const storageData = await loadFromStorage(sessionID)
    return storageData[file]
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    const current = state()
    const currentLock = current.locks.get(filepath) ?? Promise.resolve()
    let release: () => void = () => {}
    const nextLock = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = currentLock.then(() => nextLock)
    current.locks.set(filepath, chained)
    await currentLock
    try {
      return await fn()
    } finally {
      release()
      if (current.locks.get(filepath) === chained) {
        current.locks.delete(filepath)
      }
    }
  }

  export async function assert(sessionID: string, filepath: string): Promise<void> {
    if (Flag.NIKCLI_DISABLE_FILETIME_CHECK === true) {
      return
    }

    const tracked = await getEntry(sessionID, filepath)
    if (!tracked) {
      throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)
    }

    const stats = await Bun.file(filepath).stat()
    const currentMtime = stats.mtimeMs
    const currentSize = stats.size

    if (currentMtime !== tracked.mtime || currentSize !== tracked.size) {
      const message =
        `File "${filepath}" has been modified externally since it was last read.\n` +
        `Last read: ${new Date(tracked.read).toISOString()}\n` +
        `Last modified: ${new Date(tracked.mtime).toISOString()}\n` +
        `Current modified: ${new Date(currentMtime).toISOString()}\n` +
        `Please read the file again before modifying it.`

      log.warn("external modification detected", {
        filepath,
        trackedMtime: tracked.mtime,
        trackedSize: tracked.size,
        currentMtime,
        currentSize,
      })

      throw new FileModifiedError(filepath, message)
    }
  }

  export async function clear(sessionID: string, filepath?: string): Promise<void> {
    const { read } = state()
    if (filepath) {
      delete read[sessionID]?.[filepath]
      const storageData = await loadFromStorage(sessionID)
      delete storageData[filepath]
      await saveToStorage(sessionID, storageData)
    } else {
      delete read[sessionID]
      const { dir } = await storage()
      const target = path.join(dir, `${sessionID}.json`)
      await Bun.file(target)
        .delete()
        .catch(() => {})
    }
  }

  export async function list(sessionID: string): Promise<string[]> {
    const storageData = await loadFromStorage(sessionID)
    return Object.keys(storageData)
  }
}
