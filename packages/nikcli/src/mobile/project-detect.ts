import z from "zod"
import { Log } from "@nikcli-ai/util/log"
import path from "path"
import { existsSync, readdirSync } from "fs"

const log = Log.create({ service: "mobile-project-detect" })

function hasFile(dir: string, name: string): boolean {
  return existsSync(path.join(dir, name))
}

async function findMonorepoRoot(startDir: string): Promise<string | null> {
  let current = startDir
  while (true) {
    if (
      hasFile(current, "turbo.json") ||
      hasFile(current, "nx.json") ||
      hasFile(current, "lerna.json") ||
      hasFile(current, "pnpm-workspace.yaml")
    ) {
      return current
    }
    const pkg = await readJsonSafe(current, "package.json")
    if (pkg) {
      const hasWs =
        (Array.isArray(pkg.workspaces) && (pkg.workspaces as unknown[]).length > 0) ||
        (typeof pkg.workspaces === "object" &&
          !Array.isArray(pkg.workspaces) &&
          Array.isArray((pkg.workspaces as Record<string, unknown>).packages))
      if (hasWs) return current
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function isMonorepo(dir: string): Promise<boolean> {
  if (hasFile(dir, "turbo.json") || hasFile(dir, "nx.json") || hasFile(dir, "lerna.json")) return true
  if (hasFile(dir, "pnpm-workspace.yaml")) return true
  const pkg = await readJsonSafe(dir, "package.json")
  if (pkg && Array.isArray(pkg.workspaces) && (pkg.workspaces as unknown[]).length > 0) return true
  if (pkg && typeof pkg.workspaces === "object" && !Array.isArray(pkg.workspaces)) {
    const ws = pkg.workspaces as Record<string, unknown>
    if (Array.isArray(ws.packages) && (ws.packages as unknown[]).length > 0) return true
  }
  return false
}

async function workspaceGlobs(dir: string): Promise<string[]> {
  const globs: string[] = []

  if (hasFile(dir, "pnpm-workspace.yaml")) {
    try {
      const text = await Bun.file(path.join(dir, "pnpm-workspace.yaml")).text()
      const matches = text.match(/^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*$/gm) ?? []
      for (const m of matches) {
        const g = m
          .replace(/^\s*-\s*['"]?/, "")
          .replace(/['"]?\s*$/, "")
          .trim()
        if (g) globs.push(g)
      }
    } catch {}
  }

  const pkg = await readJsonSafe(dir, "package.json")
  if (pkg) {
    const raw = Array.isArray(pkg.workspaces)
      ? (pkg.workspaces as string[])
      : Array.isArray((pkg.workspaces as Record<string, unknown>)?.packages)
        ? (pkg.workspaces as Record<string, string[]>).packages
        : []
    globs.push(...raw)
  }

  return [...new Set(globs)]
}

async function monorepoMobileCandidates(dir: string): Promise<string[]> {
  const candidates: string[] = []
  const seen = new Set<string>()

  function add(p: string) {
    const abs = path.resolve(dir, p)
    if (!seen.has(abs) && existsSync(abs)) {
      seen.add(abs)
      candidates.push(abs)
    }
  }

  const globs = await workspaceGlobs(dir)
  for (const g of globs) {
    if (g.endsWith("/*") || g.endsWith("/**")) {
      const base = path.join(dir, g.replace(/\/\*+$/, ""))
      if (existsSync(base)) {
        try {
          for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (entry.isDirectory()) add(path.join(base, entry.name))
          }
        } catch {}
      }
    } else {
      add(g)
    }
  }

  // Always check common monorepo dirs regardless of workspace config
  const commonPatterns = ["apps", "packages", "mobile", "native", "app", "ios", "android"]
  for (const p of commonPatterns) {
    const abs = path.join(dir, p)
    if (!existsSync(abs)) continue
    try {
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (entry.isDirectory()) add(path.join(abs, entry.name))
      }
    } catch {}
    // also try the dir itself (e.g. a top-level "mobile/" that is the app)
    add(abs)
  }

  return candidates
}

async function hasAnyGlob(dir: string, pattern: string): Promise<boolean> {
  try {
    const glob = new Bun.Glob(pattern)
    const scanner = glob.scan({ cwd: dir, absolute: false, onlyFiles: false })
    const first = await scanner.next()
    return !first.done && first.value !== undefined
  } catch {
    return false
  }
}

async function readJsonSafe(dir: string, name: string): Promise<Record<string, unknown> | null> {
  const filePath = path.join(dir, name)
  if (!existsSync(filePath)) return null
  try {
    const text = await Bun.file(filePath).text()
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

function hasDependency(pkg: Record<string, unknown> | null, name: string): boolean {
  if (!pkg) return false
  const deps = pkg.dependencies as Record<string, unknown> | undefined
  const devDeps = pkg.devDependencies as Record<string, unknown> | undefined
  return Boolean(deps?.[name]) || Boolean(devDeps?.[name])
}

export namespace MobileProjectDetect {
  export const Platform = z.enum(["ios", "android", "expo", "flutter", "react-native"])
  export type Platform = z.infer<typeof Platform>

  const BuildConfig = z.object({
    command: z.array(z.string()),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    artifactPatterns: z.array(z.string()).optional(),
  })
  export type BuildConfig = z.infer<typeof BuildConfig>

  export const DetectionMethod = z.enum([
    "package.json:expo",
    "package.json:react-native",
    "xcodeproj",
    "xcworkspace",
    "gradle",
    "pubspec.yaml",
  ])
  export type DetectionMethod = z.infer<typeof DetectionMethod>

  export const Detected = z.object({
    platforms: Platform.array().min(1),
    primaryPlatform: Platform,
    buildConfigs: z.record(z.string(), BuildConfig),
    method: DetectionMethod,
    detectedAt: z.number(),
    root: z.string(),
  })
  export type Detected = z.infer<typeof Detected>

  async function detectExpo(dir: string): Promise<Detected | null> {
    if (!hasFile(dir, "package.json")) return null
    const pkg = await readJsonSafe(dir, "package.json")
    if (!hasDependency(pkg, "expo")) return null

    const platforms: Platform[] = []
    const buildConfigs: Record<string, BuildConfig> = {}

    if (hasFile(dir, "ios") || hasFile(dir, "apps")) {
      platforms.push("ios")
      buildConfigs.ios = {
        command: ["npx", "eas", "build", "--platform", "ios", "--non-interactive"],
        artifactPatterns: ["build/*.ipa", "build/*.tar.gz"],
      }
    }
    if (hasFile(dir, "android") || hasFile(dir, "apps")) {
      platforms.push("android")
      buildConfigs.android = {
        command: ["npx", "eas", "build", "--platform", "android", "--non-interactive"],
        artifactPatterns: ["build/*.apk", "build/*.aab"],
      }
    }

    if (!platforms.length) {
      platforms.push("expo" as Platform)
    }

    return {
      platforms,
      primaryPlatform: "expo" as Platform,
      buildConfigs,
      method: "package.json:expo",
      detectedAt: Date.now(),
      root: dir,
    }
  }

  async function detectReactNative(dir: string): Promise<Detected | null> {
    if (!hasFile(dir, "package.json")) return null
    const pkg = await readJsonSafe(dir, "package.json")
    if (!hasDependency(pkg, "react-native")) return null
    if (hasDependency(pkg, "expo")) return null

    const platforms: Platform[] = ["react-native" as Platform]
    const buildConfigs: Record<string, BuildConfig> = {}

    if (hasFile(dir, "ios")) {
      platforms.push("ios" as Platform)
      buildConfigs.ios = {
        command: ["npx", "react-native", "run-ios"],
        artifactPatterns: ["ios/build/*.app", "ios/build/*.ipa"],
      }
    }
    if (hasFile(dir, "android")) {
      platforms.push("android" as Platform)
      buildConfigs.android = {
        command: ["npx", "react-native", "run-android"],
        artifactPatterns: ["android/app/build/outputs/**/*.apk"],
      }
    }

    return {
      platforms,
      primaryPlatform: "react-native" as Platform,
      buildConfigs,
      method: "package.json:react-native",
      detectedAt: Date.now(),
      root: dir,
    }
  }

  async function detectNativeIOS(dir: string): Promise<Detected | null> {
    const hasWorkspace = await hasAnyGlob(dir, "*.xcworkspace")
    const hasProject = await hasAnyGlob(dir, "*.xcodeproj")
    if (!hasWorkspace && !hasProject) return null

    return {
      platforms: ["ios" as Platform],
      primaryPlatform: "ios" as Platform,
      buildConfigs: {
        ios: {
          command: ["xcodebuild", "-scheme", "<scheme>", "-sdk", "iphonesimulator", "-configuration", "Debug", "build"],
          artifactPatterns: ["DerivedData/**/*.app", "DerivedData/**/*.ipa", "build/*.app"],
        },
      },
      method: hasWorkspace ? "xcworkspace" : "xcodeproj",
      detectedAt: Date.now(),
      root: dir,
    }
  }

  async function detectNativeAndroid(dir: string): Promise<Detected | null> {
    const hasGradle = hasFile(dir, "build.gradle") || hasFile(dir, "build.gradle.kts")
    const hasSettings = hasFile(dir, "settings.gradle") || hasFile(dir, "settings.gradle.kts")
    if (!hasGradle || !hasSettings) return null

    const hasGradlew = hasFile(dir, "gradlew")
    const buildCmd = hasGradlew ? ["./gradlew", "assembleDebug"] : ["gradle", "assembleDebug"]

    return {
      platforms: ["android" as Platform],
      primaryPlatform: "android" as Platform,
      buildConfigs: {
        android: {
          command: buildCmd,
          artifactPatterns: ["app/build/outputs/**/*.apk", "build/outputs/**/*.apk"],
        },
      },
      method: "gradle",
      detectedAt: Date.now(),
      root: dir,
    }
  }

  async function detectFlutter(dir: string): Promise<Detected | null> {
    if (!hasFile(dir, "pubspec.yaml")) return null
    const hasLib = hasFile(dir, "lib")
    const hasTest = hasFile(dir, "test")
    if (!hasLib && !hasTest) return null

    return {
      platforms: ["flutter" as Platform],
      primaryPlatform: "flutter" as Platform,
      buildConfigs: {
        ios: {
          command: ["flutter", "build", "ios"],
          artifactPatterns: ["build/ios/iphoneos/*.app"],
        },
        android: {
          command: ["flutter", "build", "apk"],
          artifactPatterns: ["build/app/outputs/**/*.apk"],
        },
      },
      method: "pubspec.yaml",
      detectedAt: Date.now(),
      root: dir,
    }
  }

  const detectors = [detectExpo, detectReactNative, detectFlutter, detectNativeIOS, detectNativeAndroid] as const

  async function runDetectors(dir: string): Promise<Detected | null> {
    for (const detector of detectors) {
      try {
        const result = await detector(dir)
        if (result) return result
      } catch (error) {
        log.warn("detector failed", { directory: dir, detector: detector.name, error })
      }
    }
    return null
  }

  export async function detect(directory: string): Promise<Detected | null> {
    const direct = await runDetectors(directory)
    if (direct) {
      log.info("detected mobile project", { directory, method: direct.method, platforms: direct.platforms })
      return direct
    }

    // Walk up the tree to find the monorepo root (handles running from a subpackage)
    const monorepoRoot = await findMonorepoRoot(directory)
    if (!monorepoRoot) return null

    log.info("monorepo root found, scanning candidates", { directory, monorepoRoot })
    const candidates = await monorepoMobileCandidates(monorepoRoot)

    for (const candidate of candidates) {
      // Skip the starting directory — already checked above
      if (candidate === directory) continue
      const result = await runDetectors(candidate)
      if (result) {
        log.info("detected mobile project in monorepo", {
          monorepoRoot,
          candidate,
          method: result.method,
          platforms: result.platforms,
        })
        return result
      }
    }

    return null
  }
}
