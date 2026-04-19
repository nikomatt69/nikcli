import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Git } from "@/git"
import z from "zod"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { FileIgnore } from "./ignore"
import { Config } from "../config/config"
import path from "path"
import os from "os"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import type ParcelWatcher from "@parcel/watcher"
import { Flag } from "@/flag/flag"
import { readdir } from "fs/promises"

const SUBSCRIBE_TIMEOUT_MS = 10_000

declare const NIKCLI_LIBC: string | undefined

const PROTECTED_PATHS = (() => {
  const home = os.homedir()
  if (process.platform === "darwin") {
    return [
      path.join(home, "Music"),
      path.join(home, "Pictures"),
      path.join(home, "Movies"),
      path.join(home, "Downloads"),
      path.join(home, "Desktop"),
      path.join(home, "Documents"),
      path.join(home, "Public"),
      path.join(home, "Applications"),
      path.join(home, "Library"),
      path.join(home, "Library", "Application Support", "AddressBook"),
      path.join(home, "Library", "Calendars"),
      path.join(home, "Library", "Mail"),
      path.join(home, "Library", "Messages"),
      path.join(home, "Library", "Safari"),
      path.join(home, "Library", "Cookies"),
      path.join(home, "Library", "Application Support", "com.apple.TCC"),
      path.join(home, "Library", "PersonalizationPortrait"),
      path.join(home, "Library", "Metadata", "CoreSpotlight"),
      path.join(home, "Library", "Suggestions"),
      "/.DocumentRevisions-V100",
      "/.Spotlight-V100",
      "/.Trashes",
      "/.fseventsd",
    ]
  }
  if (process.platform === "win32") {
    return [
      path.join(home, "AppData"),
      path.join(home, "Downloads"),
      path.join(home, "Desktop"),
      path.join(home, "Documents"),
      path.join(home, "Pictures"),
      path.join(home, "Music"),
      path.join(home, "Videos"),
      path.join(home, "OneDrive"),
    ]
  }
  return [] as string[]
})()

function isBlockedPath(target: string): boolean {
  const resolved = path.resolve(target)
  const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved

  return PROTECTED_PATHS.some((candidate) => {
    const blocked = process.platform === "win32" ? path.resolve(candidate).toLowerCase() : path.resolve(candidate)
    return normalized === blocked || normalized.startsWith(blocked + path.sep)
  })
}

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
    try {
      const binding = require(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${NIKCLI_LIBC || "glibc"}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (error) {
      log.error("failed to load watcher binding", { error })
      return
    }
  })

  const state = Instance.state(
    async () => {
      if (Instance.project.vcs !== "git") return {}
      if (isBlockedPath(Instance.directory)) {
        log.warn("skipping watcher: protected system directory", { dir: Instance.directory })
        return {}
      }
      log.info("init")
      const cfg = await Config.get()
      const backend = (() => {
        if (process.platform === "win32") return "windows"
        if (process.platform === "darwin") return "fs-events"
        if (process.platform === "linux") return "inotify"
      })()
      if (!backend) {
        log.error("watcher backend not supported", { platform: process.platform })
        return {}
      }
      log.info("watcher backend", { platform: process.platform, backend })

      const w = watcher()
      if (!w) return {}

      const subscribe: ParcelWatcher.SubscribeCallback = (err, evts) => {
        if (err) return
        for (const evt of evts) {
          if (evt.type === "create") Bus.publish(Event.Updated, { file: evt.path, event: "add" })
          if (evt.type === "update") Bus.publish(Event.Updated, { file: evt.path, event: "change" })
          if (evt.type === "delete") Bus.publish(Event.Updated, { file: evt.path, event: "unlink" })
        }
      }

      const subs: ParcelWatcher.AsyncSubscription[] = []
      const cfgIgnores = cfg.watcher?.ignore ?? []

      if (Flag.NIKCLI_EXPERIMENTAL_FILEWATCHER) {
        if (isBlockedPath(Instance.directory)) {
          log.warn("skipping watcher subscription: protected path", { dir: Instance.directory })
        } else {
          const pending = w.subscribe(Instance.directory, subscribe, {
            ignore: [...FileIgnore.PATTERNS, ...cfgIgnores],
            backend,
          })
          const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
            log.error("failed to subscribe to Instance.directory", { error: err })
            pending.then((s) => s.unsubscribe()).catch(() => {})
            return undefined
          })
          if (sub) subs.push(sub)
        }
      }

      const gitResult = await Git.run(["rev-parse", "--git-dir"], { cwd: Instance.worktree })
      const vcsDir = gitResult.exitCode === 0 ? path.resolve(Instance.worktree, gitResult.text().trim()) : undefined
      if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
        if (isBlockedPath(vcsDir)) {
          log.warn("skipping watcher subscription: protected git dir", { dir: vcsDir })
        } else {
          const gitDirContents = await readdir(vcsDir).catch(() => [])
          const ignoreList = gitDirContents.filter((entry) => entry !== "HEAD")
          const pending = w.subscribe(vcsDir, subscribe, {
            ignore: ignoreList,
            backend,
          })
          const sub = await withTimeout(pending, SUBSCRIBE_TIMEOUT_MS).catch((err) => {
            log.error("failed to subscribe to vcsDir", { error: err })
            pending.then((s) => s.unsubscribe()).catch(() => {})
            return undefined
          })
          if (sub) subs.push(sub)
        }
      }

      return { subs }
    },
    async (state) => {
      if (!state.subs) return
      await Promise.all(state.subs.map((sub) => sub?.unsubscribe()))
    },
  )

  export function init() {
    if (Flag.NIKCLI_EXPERIMENTAL_DISABLE_FILEWATCHER) {
      return
    }
    state()
  }
}
