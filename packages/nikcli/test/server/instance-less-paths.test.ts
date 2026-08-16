import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import path from "path"

import { instanceLessRoot, instanceLessRoots, isAccountPath, isInstanceLessPath } from "@/server/httpapi/instance-less"

/**
 * The instance-less roots (`/global`, `/user`, `/account`) are decided in four
 * places: `HttpApiBridge.handleGlobal`, `Server.fallback`, `ServerRouter.dispatch`
 * and `PublicRoutes.globalRequest`. Before the shared table they each spelled the
 * prefixes out, so a forgotten site sent the request down the instance branch,
 * where it 404s with no directory bound — a failure that reads as a legitimate
 * "not found" and reports itself nowhere.
 *
 * These tests pin both halves: the predicate's shape, and that the four sites
 * ask it instead of re-spelling the prefixes.
 */
const SRC = path.join(import.meta.dir, "..", "..", "src")

const DECISION_SITES = [
  "server/httpapi/bridge.ts",
  "server/server.ts",
  "server/server-router.ts",
  "server/public.ts",
]

describe("instance-less paths", () => {
  it("claims the bare path as well as the subtree for every root", () => {
    for (const root of instanceLessRoots()) {
      expect(isInstanceLessPath(root)).toBe(true)
      expect(isInstanceLessPath(`${root}/anything`)).toBe(true)
      expect(instanceLessRoot(`${root}/anything`)).toBe(root)
      // A longer first segment is a different route, not this subtree.
      expect(isInstanceLessPath(`${root}s`)).toBe(false)
      // The root name appearing later in the path is instance-scoped.
      expect(isInstanceLessPath(`/session${root}`)).toBe(false)
    }
  })

  it("leaves instance-scoped paths alone", () => {
    for (const pathname of ["/", "/session", "/session/abc/message", "/config", "/mobile/session"]) {
      expect(isInstanceLessPath(pathname)).toBe(false)
      expect(instanceLessRoot(pathname)).toBeUndefined()
    }
  })

  it("keeps the account predicate in agreement with the table", () => {
    expect(isAccountPath("/account")).toBe(true)
    expect(isAccountPath("/account/login")).toBe(true)
    expect(isAccountPath("/accounts")).toBe(false)
    expect(isInstanceLessPath("/account")).toBe(true)
  })

  it("is the only place the roots are spelled out", async () => {
    const offenders: string[] = []
    for (const site of DECISION_SITES) {
      const source = await fs.readFile(path.join(SRC, site), "utf8")
      for (const root of instanceLessRoots()) {
        if (source.includes(`startsWith("${root}/")`)) offenders.push(`${site}: startsWith("${root}/")`)
      }
    }
    expect(offenders).toEqual([])
  })
})
