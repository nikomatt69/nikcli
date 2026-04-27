import { describe, expect, it } from "bun:test"
import { FileType } from "@/util/is-text"

describe("FileType", () => {
  describe("extension", () => {
    it("returns lowercase extension", () => {
      expect(FileType.extension("foo.TS")).toBe("ts")
      expect(FileType.extension("a.b.c.tar.gz")).toBe("gz")
    })

    it("returns empty when no extension", () => {
      expect(FileType.extension("Dockerfile")).toBe("")
      expect(FileType.extension("Makefile")).toBe("")
      expect(FileType.extension("noext")).toBe("")
    })
  })

  describe("isText / isBinary", () => {
    it("classifies common text and binary extensions", () => {
      expect(FileType.isText("src/foo.ts")).toBe(true)
      expect(FileType.isText("readme.md")).toBe(true)
      expect(FileType.isBinary("img.png")).toBe(true)
      expect(FileType.isBinary("data.bin")).toBe(true)
    })

    it("treats dotfiles with ignore or env in the name as text", () => {
      expect(FileType.isText(".gitignore")).toBe(true)
      expect(FileType.isText(".env.local")).toBe(true)
    })

    it("isBinary is negation of isText for known cases", () => {
      expect(FileType.isBinary("x.ts")).toBe(!FileType.isText("x.ts"))
      expect(FileType.isBinary("x.png")).toBe(!FileType.isText("x.png"))
    })
  })

  describe("media and archive helpers", () => {
    it("detects images", () => {
      expect(FileType.isImage("a.webp")).toBe(true)
      expect(FileType.isImage("a.ts")).toBe(false)
    })

    it("detects video and audio", () => {
      expect(FileType.isVideo("clip.mp4")).toBe(true)
      expect(FileType.isAudio("song.flac")).toBe(true)
    })

    it("detects archives", () => {
      expect(FileType.isArchive("dist.zip")).toBe(true)
      expect(FileType.isArchive("backup.tar.gz")).toBe(true)
    })
  })

  describe("isCode / isConfig / isDocument", () => {
    it("detects code-like extensions", () => {
      expect(FileType.isCode("app.tsx")).toBe(true)
      expect(FileType.isCode("notes.txt")).toBe(false)
    })

    it("detects config-like names and extensions", () => {
      expect(FileType.isConfig("settings.json")).toBe(true)
      expect(FileType.isConfig("app.config.ts")).toBe(true)
    })

    it("detects document extensions", () => {
      expect(FileType.isDocument("paper.pdf")).toBe(true)
      expect(FileType.isDocument("sheet.csv")).toBe(true)
    })
  })
})
