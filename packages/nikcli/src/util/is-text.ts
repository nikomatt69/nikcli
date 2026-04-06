import { BINARY_EXTENSIONS } from "./binary-extensions"
import { TEXT_EXTENSIONS } from "./text-extensions"

export namespace FileType {
  export function extension(filename: string): string {
    const lastDot = filename.lastIndexOf(".")
    if (lastDot === -1 || lastDot === filename.length - 1) return ""
    return filename.slice(lastDot + 1).toLowerCase()
  }

  export function isText(filename: string): boolean {
    const ext = extension(filename)
    if (!ext) return false
    if (TEXT_EXTENSIONS.has(ext)) return true
    if (BINARY_EXTENSIONS.has(ext)) return false
    const name = filename.toLowerCase()
    if (name === "dockerfile") return true
    if (name === "makefile") return true
    if (name.startsWith(".")) {
      if (name.includes("ignore")) return true
      if (name.includes("git")) return true
      if (name.includes("editorconfig")) return true
      if (name.includes("nvmrc")) return true
      if (name.includes("npmrc")) return true
      if (name.includes("prettierrc")) return true
      if (name.includes("eslintrc")) return true
      if (name.includes("env")) return true
      if (name === "deno.json" || name === "deno.jsonc") return true
    }
    return false
  }

  export function isBinary(filename: string): boolean {
    return !isText(filename)
  }

  export function isImage(filename: string): boolean {
    const ext = extension(filename)
    return [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "ico",
      "bmp",
      "tiff",
      "tif",
      "raw",
      "cr2",
      "nef",
      "arw",
      "dng",
      "heic",
      "heif",
      "avif",
      "apng",
    ].includes(ext)
  }

  export function isVideo(filename: string): boolean {
    const ext = extension(filename)
    return [
      "mp4",
      "avi",
      "mov",
      "wmv",
      "flv",
      "webm",
      "mkv",
      "m4v",
      "mpeg",
      "mpg",
      "3gp",
      "3g2",
      "f4v",
      "ts",
      "mts",
      "m2ts",
      "ogv",
      "ogx",
    ].includes(ext)
  }

  export function isAudio(filename: string): boolean {
    const ext = extension(filename)
    return [
      "mp3",
      "wav",
      "ogg",
      "oga",
      "flac",
      "aac",
      "wma",
      "m4a",
      "weba",
      "opus",
      "ape",
      "mka",
      "dts",
      "ac3",
      "eac3",
    ].includes(ext)
  }

  export function isArchive(filename: string): boolean {
    const ext = extension(filename)
    return [
      "zip",
      "tar",
      "gz",
      "gzip",
      "bz2",
      "7z",
      "rar",
      "xz",
      "lz",
      "lzma",
      "cab",
      "iso",
      "dmg",
      "img",
      "pkg",
      "deb",
      "rpm",
      "apk",
    ].includes(ext)
  }

  export function isDocument(filename: string): boolean {
    const ext = extension(filename)
    return [
      "pdf",
      "doc",
      "docx",
      "dot",
      "dotx",
      "xls",
      "xlsx",
      "xlt",
      "xltx",
      "ppt",
      "pptx",
      "pot",
      "potx",
      "pps",
      "ppsx",
      "odt",
      "ods",
      "odp",
      "rtf",
      "wks",
      "wk1",
      "csv",
      "tsv",
    ].includes(ext)
  }

  export function isCode(filename: string): boolean {
    const ext = extension(filename)
    const codeExtensions = [
      "ts",
      "tsx",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "py",
      "rb",
      "php",
      "java",
      "go",
      "rs",
      "cs",
      "cpp",
      "c",
      "h",
      "swift",
      "kt",
      "scala",
      "hs",
      "ml",
      "erl",
      "ex",
      "exs",
      "clj",
      "cljs",
      "lisp",
      "scm",
      "rkt",
      "lua",
      "nim",
      "zig",
      "odin",
      "v",
      "vhdl",
      "dart",
      "groovy",
      "gradle",
      "bash",
      "sh",
      "zsh",
      "fish",
      "ps1",
      "sql",
      "graphql",
      "r",
      "julia",
      "matlab",
      "f",
      "f90",
      "ada",
      "asm",
      "awk",
      "sed",
      "vim",
      "elisp",
    ]
    return codeExtensions.includes(ext)
  }

  export function isConfig(filename: string): boolean {
    const ext = extension(filename)
    const configExtensions = [
      "json",
      "jsonc",
      "json5",
      "yaml",
      "yml",
      "toml",
      "ini",
      "cfg",
      "conf",
      "xml",
      "env",
      "properties",
    ]
    if (configExtensions.includes(ext)) return true
    const name = filename.toLowerCase()
    if (name === "dockerfile") return true
    if (name === "makefile") return true
    if (name.includes("config")) return true
    if (name.includes("settings")) return true
    if (name.endsWith("rc")) return true
    if (name.startsWith(".")) {
      if (name.includes("rc")) return true
      if (name.includes("config")) return true
      if (name.includes("env")) return true
    }
    return false
  }
}
