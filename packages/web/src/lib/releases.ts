// Fetches GitHub releases at request time (SSR) and classifies their assets
// into user-facing download groups. New versions and freshly uploaded assets
// appear automatically — no redeploy required.

const REPO = "nikomatt69/nikcli"
const API = `https://api.github.com/repos/${REPO}/releases`

export type DownloadCategory = "desktop" | "cli" | "mobile" | "other"
export type OS = "macos" | "windows" | "linux" | "android" | "ios" | "any"
export type Arch = "arm64" | "x64" | "universal" | "any"

export interface ClassifiedAsset {
  name: string
  url: string
  size: number
  downloadCount: number
  category: DownloadCategory
  os: OS
  arch: Arch
  /** Short human format, e.g. ".dmg", ".exe", ".tar.gz" */
  format: string
  /** Optional build variant qualifier, e.g. "baseline", "musl" */
  variant: string | null
  /** Human label used in the UI, e.g. "Apple Silicon (.dmg)" */
  label: string
}

export interface ReleaseInfo {
  tag: string
  name: string
  publishedAt: string | null
  htmlUrl: string
  prerelease: boolean
  assets: ClassifiedAsset[]
}

interface RawAsset {
  name: string
  browser_download_url: string
  size: number
  download_count: number
}
interface RawRelease {
  tag_name: string
  name: string | null
  published_at: string | null
  html_url: string
  prerelease: boolean
  draft: boolean
  assets: RawAsset[]
}

const fmtArch = (a: Arch, os: OS = "any"): string => {
  if (a === "arm64") return os === "macos" ? "Apple Silicon" : "ARM64"
  if (a === "x64") return os === "macos" ? "Intel" : "x64"
  if (a === "universal") return "Universal"
  return ""
}

const detectFormat = (name: string): string => {
  const n = name.toLowerCase()
  if (n.endsWith(".tar.gz")) return ".tar.gz"
  if (n.endsWith(".app.tar.gz")) return ".app.tar.gz"
  const dot = n.lastIndexOf(".")
  return dot >= 0 ? n.slice(dot) : ""
}

const detectArch = (name: string): Arch => {
  const n = name.toLowerCase()
  if (/(aarch64|arm64)/.test(n)) return "arm64"
  if (/(x86_64|x64|amd64|x86)/.test(n)) return "x64"
  if (/universal/.test(n)) return "universal"
  return "any"
}

/** Hidden internal/updater artifacts that shouldn't surface as downloads. */
const isInternal = (name: string): boolean => {
  const n = name.toLowerCase()
  return (
    n === "latest.json" ||
    n.endsWith(".sig") ||
    n.endsWith(".app.tar.gz") ||
    // Tauri updater zips for macOS (the .dmg is the user-facing installer)
    /-(?:aarch64|x86_64)-apple-darwin\.zip$/.test(n)
  )
}

function classify(asset: RawAsset): ClassifiedAsset {
  const name = asset.name
  const n = name.toLowerCase()
  const format = detectFormat(name)
  const arch = detectArch(name)
  let variant: string | null = null
  if (/baseline/.test(n)) variant = "baseline"
  else if (/musl/.test(n)) variant = "musl"

  let category: DownloadCategory = "other"
  let os: OS = "any"
  let label = name

  // Mobile artifacts
  if (n.endsWith(".apk") || n.endsWith(".aab")) {
    category = "mobile"
    os = "android"
    label = `Android (${format})`
  } else if (n.endsWith(".ipa")) {
    category = "mobile"
    os = "ios"
    label = `iOS (${format})`
  }
  // CLI binaries: published as nikcli-ai-<os>-<arch>...
  else if (n.startsWith("nikcli-ai-")) {
    category = "cli"
    if (/darwin/.test(n)) os = "macos"
    else if (/linux/.test(n)) os = "linux"
    else if (/windows|win/.test(n)) os = "windows"
    const variantTag = variant ? ` · ${variant}` : ""
    label = `${fmtArch(arch, os)}${variantTag} (${format})`
  }
  // Desktop GUI installers (Tauri): Nikcli_<ver>_… / Nikcli-<ver>-…
  else if (/\.dmg$/.test(n)) {
    category = "desktop"
    os = "macos"
    label = `${fmtArch(arch, os)} (.dmg)`
  } else if (/-setup\.exe$/.test(n) || /\.msi$/.test(n)) {
    category = "desktop"
    os = "windows"
    label = `${fmtArch(arch, os)} (${format === ".exe" ? "installer" : format})`
  } else if (/\.deb$/.test(n)) {
    category = "desktop"
    os = "linux"
    label = `Debian / Ubuntu — ${fmtArch(arch, os)} (.deb)`
  } else if (/\.rpm$/.test(n)) {
    category = "desktop"
    os = "linux"
    label = `Fedora / RHEL — ${fmtArch(arch, os)} (.rpm)`
  } else if (/\.appimage$/.test(n)) {
    category = "desktop"
    os = "linux"
    label = `AppImage — ${fmtArch(arch, os)} (.AppImage)`
  } else if (/\.exe$/.test(n)) {
    category = "desktop"
    os = "windows"
    label = `${fmtArch(arch, os)} (.exe)`
  }

  return {
    name,
    url: asset.browser_download_url,
    size: asset.size,
    downloadCount: asset.download_count,
    category,
    os,
    arch,
    format,
    variant,
    label,
  }
}

function shape(rel: RawRelease): ReleaseInfo {
  const assets = rel.assets
    .filter((a) => !isInternal(a.name))
    .map(classify)
    // hide unclassified noise from the primary view, keep real downloads
    .filter((a) => a.category !== "other")
  return {
    tag: rel.tag_name,
    name: rel.name || rel.tag_name,
    publishedAt: rel.published_at,
    htmlUrl: rel.html_url,
    prerelease: rel.prerelease,
    assets,
  }
}

export async function fetchReleases(limit = 30): Promise<ReleaseInfo[]> {
  const res = await fetch(`${API}?per_page=${limit}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "nikcli-web",
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const data = (await res.json()) as RawRelease[]
  return data.filter((r) => !r.draft).map(shape)
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
  } catch {
    return ""
  }
}

export const OS_META: Record<
  Exclude<OS, "any">,
  { label: string; icon: "apple" | "windows" | "linux" | "android" | "ios" }
> = {
  macos: { label: "macOS", icon: "apple" },
  windows: { label: "Windows", icon: "windows" },
  linux: { label: "Linux", icon: "linux" },
  android: { label: "Android", icon: "android" },
  ios: { label: "iOS", icon: "ios" },
}
