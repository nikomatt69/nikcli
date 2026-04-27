import { describe, expect, it, afterEach, beforeEach } from "bun:test"
import { MobileProjectDetect } from "@/mobile/project-detect"
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import os from "os"

let tmpDir: string

async function setup(): Promise<string> {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "nikcli-mobile-detect-"))
  return tmpDir
}

async function teardown(): Promise<void> {
  if (tmpDir && existsSync(tmpDir)) {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

async function writeJson(dir: string, file: string, data: unknown): Promise<void> {
  await writeFile(path.join(dir, file), JSON.stringify(data, null, 2))
}

describe("MobileProjectDetect.detect", () => {
  beforeEach(async () => {
    await setup()
  })

  afterEach(async () => {
    await teardown()
  })

  it("returns null for empty directory", async () => {
    const result = await MobileProjectDetect.detect(tmpDir)
    expect(result).toBeNull()
  })

  it("returns null for plain Node.js project with no mobile deps", async () => {
    await writeJson(tmpDir, "package.json", {
      name: "my-app",
      dependencies: { express: "^4.0.0" },
    })
    const result = await MobileProjectDetect.detect(tmpDir)
    expect(result).toBeNull()
  })

  describe("Expo detection", () => {
    it("detects expo project by dependency", async () => {
      await writeJson(tmpDir, "package.json", {
        name: "my-expo-app",
        dependencies: { expo: "^50.0.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result).not.toBeNull()
      expect(result!.method).toBe("package.json:expo")
      expect(result!.primaryPlatform).toBe("expo")
    })

    it("includes ios platform when ios dir exists", async () => {
      await mkdir(path.join(tmpDir, "ios"), { recursive: true })
      await writeJson(tmpDir, "package.json", {
        name: "my-expo-app",
        dependencies: { expo: "^50.0.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.platforms).toContain("ios")
    })

    it("includes android platform when android dir exists", async () => {
      await mkdir(path.join(tmpDir, "android"), { recursive: true })
      await writeJson(tmpDir, "package.json", {
        name: "my-expo-app",
        dependencies: { expo: "^50.0.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.platforms).toContain("android")
    })

    it("detected result has root pointing to project dir", async () => {
      await writeJson(tmpDir, "package.json", {
        dependencies: { expo: "^50.0.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.root).toBe(tmpDir)
    })

    it("detected result has a recent detectedAt timestamp", async () => {
      const before = Date.now()
      await writeJson(tmpDir, "package.json", {
        dependencies: { expo: "^50.0.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.detectedAt).toBeGreaterThanOrEqual(before)
    })
  })

  describe("React Native detection", () => {
    it("detects react-native project", async () => {
      await writeJson(tmpDir, "package.json", {
        name: "my-rn-app",
        dependencies: { "react-native": "^0.73.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result).not.toBeNull()
      expect(result!.method).toBe("package.json:react-native")
      expect(result!.primaryPlatform).toBe("react-native")
    })

    it("does not detect react-native if expo is also present (expo takes priority)", async () => {
      await writeJson(tmpDir, "package.json", {
        dependencies: { expo: "^50.0.0", "react-native": "^0.73.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.method).toBe("package.json:expo")
    })

    it("includes ios build config when ios dir exists", async () => {
      await mkdir(path.join(tmpDir, "ios"), { recursive: true })
      await writeJson(tmpDir, "package.json", {
        dependencies: { "react-native": "^0.73.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.buildConfigs.ios).toBeDefined()
    })

    it("includes android build config when android dir exists", async () => {
      await mkdir(path.join(tmpDir, "android"), { recursive: true })
      await writeJson(tmpDir, "package.json", {
        dependencies: { "react-native": "^0.73.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.buildConfigs.android).toBeDefined()
    })
  })

  describe("Flutter detection", () => {
    it("detects flutter project via pubspec.yaml + lib dir", async () => {
      await writeFile(path.join(tmpDir, "pubspec.yaml"), "name: my_flutter_app\n")
      await mkdir(path.join(tmpDir, "lib"), { recursive: true })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result).not.toBeNull()
      expect(result!.method).toBe("pubspec.yaml")
      expect(result!.primaryPlatform).toBe("flutter")
    })

    it("detects flutter via pubspec.yaml + test dir", async () => {
      await writeFile(path.join(tmpDir, "pubspec.yaml"), "name: my_flutter_app\n")
      await mkdir(path.join(tmpDir, "test"), { recursive: true })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result).not.toBeNull()
      expect(result!.primaryPlatform).toBe("flutter")
    })

    it("does not detect flutter with pubspec.yaml but no lib or test dir", async () => {
      await writeFile(path.join(tmpDir, "pubspec.yaml"), "name: my_flutter_app\n")
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result).toBeNull()
    })

    it("flutter result includes ios and android build configs", async () => {
      await writeFile(path.join(tmpDir, "pubspec.yaml"), "name: app\n")
      await mkdir(path.join(tmpDir, "lib"), { recursive: true })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.buildConfigs.ios).toBeDefined()
      expect(result!.buildConfigs.android).toBeDefined()
    })
  })

  describe("Android (Gradle) detection", () => {
    it("detects android project via build.gradle + settings.gradle", async () => {
      await writeFile(path.join(tmpDir, "build.gradle"), "// gradle build\n")
      await writeFile(path.join(tmpDir, "settings.gradle"), "rootProject.name = 'app'\n")
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result).not.toBeNull()
      expect(result!.method).toBe("gradle")
      expect(result!.primaryPlatform).toBe("android")
    })

    it("uses gradlew when available", async () => {
      await writeFile(path.join(tmpDir, "build.gradle"), "")
      await writeFile(path.join(tmpDir, "settings.gradle"), "")
      await writeFile(path.join(tmpDir, "gradlew"), "#!/bin/sh\n")
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.buildConfigs.android!.command[0]).toBe("./gradlew")
    })

    it("uses gradle command when no gradlew", async () => {
      await writeFile(path.join(tmpDir, "build.gradle"), "")
      await writeFile(path.join(tmpDir, "settings.gradle"), "")
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.buildConfigs.android!.command[0]).toBe("gradle")
    })
  })

  describe("result schema validation", () => {
    it("detected result passes Detected schema validation", async () => {
      await writeJson(tmpDir, "package.json", {
        dependencies: { expo: "^50.0.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(() => MobileProjectDetect.Detected.parse(result)).not.toThrow()
    })

    it("platforms array is non-empty", async () => {
      await writeJson(tmpDir, "package.json", {
        dependencies: { expo: "^50.0.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      expect(result!.platforms.length).toBeGreaterThan(0)
    })

    it("primaryPlatform is one of the valid platforms", async () => {
      await writeJson(tmpDir, "package.json", {
        dependencies: { "react-native": "^0.73.0" },
      })
      const result = await MobileProjectDetect.detect(tmpDir)
      const validPlatforms = ["ios", "android", "expo", "flutter", "react-native"]
      expect(validPlatforms).toContain(result!.primaryPlatform)
    })
  })
})
