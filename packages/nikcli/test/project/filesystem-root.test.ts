import { describe, expect, it } from "bun:test"
import path from "path"
import { isFilesystemRoot } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"

// `Instance.containsPath` uses this to decide whether the worktree is a real
// containment boundary or the "no repository" fallback, which is
// `path.parse(dir).root`. Getting it wrong is not a cosmetic bug: a root that
// is mistaken for a boundary reports every path on the volume as inside the
// instance, and the callers that gate on it — the bash tool's
// external-directory permission among them — stop prompting.
describe("isFilesystemRoot", () => {
  it("recognises the root of the running platform", () => {
    const root = path.parse(process.cwd()).root
    expect(isFilesystemRoot(root)).toBe(true)
  })

  it("recognises the POSIX root on any platform", () => {
    // Kept explicit because `/` was the only spelling the old check knew, and a
    // regression that dropped it would go unnoticed on Windows.
    expect(isFilesystemRoot("/")).toBe(true)
  })

  it("does not treat an ordinary directory as a root", () => {
    expect(isFilesystemRoot(process.cwd())).toBe(false)
    expect(isFilesystemRoot(path.join(path.parse(process.cwd()).root, "some-directory"))).toBe(false)
  })

  it("treats an empty string as not a root", () => {
    // `path.parse("").root` is `""`, which would otherwise equal the input and
    // report every path as contained.
    expect(isFilesystemRoot("")).toBe(false)
  })

  it("is the check that matters: a root contains everything on its volume", () => {
    // The reason the predicate exists. If this ever stops holding, the guard in
    // `containsPath` is no longer load-bearing and can be revisited.
    const root = path.parse(process.cwd()).root
    expect(Filesystem.contains(root, path.join(root, "any", "path", "at", "all"))).toBe(true)
  })
})
