import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import {
  parseFinding,
  isFileReal,
  validateFindingReal,
  validateFindingLogical,
  findPropagationFiles,
  checkRegressionRisk,
  validateFindings,
  formatFindingsReport,
  type Finding,
} from "@/util/findings"
import fs from "fs/promises"
import path from "path"

const TEST_DIR = "/tmp/nikcli-findings-test"

async function setup() {
  await fs.mkdir(TEST_DIR, { recursive: true })
  // Create a test file
  await fs.writeFile(
    path.join(TEST_DIR, "test-file.ts"),
    `export function hello(name: string): string {
  return "Hello, " + name
}

export class TestClass {
  public value: number = 0

  public getValue(): number {
    return this.value
  }
}`,
    "utf8",
  )
  // Create a deep nested file
  await fs.mkdir(path.join(TEST_DIR, "util"), { recursive: true })
  await fs.writeFile(
    path.join(TEST_DIR, "util", "helper.ts"),
    `export function helper(): string {
  return "helper"
}`,
    "utf8",
  )
}

async function teardown() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true })
  } catch {}
}

beforeAll(setup)
afterAll(teardown)

describe("parseFinding", () => {
  it("parses a valid finding block", () => {
    const block = `### [HIGH] Memory leak in handler
**File:** \`test-file.ts\` (line 5)
**Issue:** The function accumulates listeners without cleanup, causing memory leaks
**Fix:** Add event listener cleanup on component unmount`
    const finding = parseFinding(block)
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe("HIGH")
    expect(finding!.title).toBe("Memory leak in handler")
    expect(finding!.file).toBe("test-file.ts")
    expect(finding!.line).toBe(5)
    expect(finding!.issue).toContain("accumulates listeners")
    expect(finding!.fix).toBeDefined()
  })

  it("parses finding without fix", () => {
    const block = `### [MEDIUM] Unused parameter
**File:** \`test-file.ts\` (line 1)
**Issue:** Parameter 'name' is declared but never used`
    const finding = parseFinding(block)
    expect(finding).toBeDefined()
    expect(finding!.fix).toBeUndefined()
  })

  it("parses finding without line number", () => {
    const block = `### [LOW] Naming convention
**File:** \`test-file.ts\`
**Issue:** Function names should use camelCase`
    const finding = parseFinding(block)
    expect(finding).toBeDefined()
    expect(finding!.line).toBeUndefined()
  })

  it("returns undefined for invalid block", () => {
    const block = `This is not a valid finding block`
    const finding = parseFinding(block)
    expect(finding).toBeUndefined()
  })
})

describe("isFileReal", () => {
  it("returns true for existing file", async () => {
    const exists = await isFileReal("test-file.ts", TEST_DIR)
    expect(exists).toBe(true)
  })

  it("returns false for non-existent file", async () => {
    const exists = await isFileReal("non-existent.ts", TEST_DIR)
    expect(exists).toBe(false)
  })

  it("handles absolute paths", async () => {
    const filePath = path.join(TEST_DIR, "test-file.ts")
    const exists = await isFileReal(filePath, "/tmp")
    expect(exists).toBe(true)
  })
})

describe("validateFindingReal", () => {
  it("validates a real finding", async () => {
    const finding: Finding = {
      file: "test-file.ts",
      line: 1,
      title: "Test",
      issue: "Test issue",
      severity: "MEDIUM",
      verified: false,
    }
    const result = await validateFindingReal(finding, TEST_DIR)
    expect(result.valid).toBe(true)
    expect(result.finding?.verified).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it("rejects non-existent file", async () => {
    const finding: Finding = {
      file: "non-existent.ts",
      title: "Missing",
      issue: "Missing file",
      severity: "MEDIUM",
      verified: false,
    }
    const result = await validateFindingReal(finding, TEST_DIR)
    expect(result.valid).toBe(false)
    expect(result.issues).toContain("File does not exist: non-existent.ts")
  })

  it("rejects out-of-range line number", async () => {
    const finding: Finding = {
      file: "test-file.ts",
      line: 1000,
      title: "Invalid line",
      issue: "Line out of range",
      severity: "MEDIUM",
      verified: false,
    }
    const result = await validateFindingReal(finding, TEST_DIR)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes("out of range"))).toBe(true)
  })
})

describe("validateFindingLogical", () => {
  it("accepts a well-formed finding", () => {
    const finding: Finding = {
      file: "test.ts",
      title: "Null check missing",
      issue: "The function does not check for null input, causing a runtime error when null is passed",
      severity: "HIGH",
      fix: "Add a null check at the start of the function",
      verified: false,
    }
    const result = validateFindingLogical(finding)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it("rejects overly vague issue", () => {
    const finding: Finding = {
      file: "test.ts",
      title: "Maybe problem",
      issue: "This might cause some issues",
      severity: "HIGH",
      verified: false,
    }
    const result = validateFindingLogical(finding)
    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("vague language")
  })

  it("warns for missing fix on high severity", () => {
    const finding: Finding = {
      file: "test.ts",
      title: "Critical bug",
      issue: "This is definitely a real and serious bug that needs fixing",
      severity: "CRITICAL",
      verified: false,
    }
    const result = validateFindingLogical(finding)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes("lacks a fix suggestion"))).toBe(true)
  })
})

describe("findPropagationFiles", () => {
  it("finds related files for util changes", () => {
    const changedFiles = ["util/helper.ts", "util/format.ts", "other/file.ts"]
    const finding: Finding = {
      file: "util/helper.ts",
      title: "Helper change",
      issue: "Changed helper function signature",
      severity: "MEDIUM",
      verified: true,
    }
    const propagated = findPropagationFiles(finding, TEST_DIR, changedFiles)
    expect(propagated).toContain("util/format.ts")
  })

  it("returns empty for non-propagating changes", () => {
    const changedFiles = ["src/file.ts", "test/file.test.ts"]
    const finding: Finding = {
      file: "src/file.ts",
      title: "Local change",
      issue: "Changed specific function",
      severity: "LOW",
      verified: true,
    }
    const propagated = findPropagationFiles(finding, TEST_DIR, changedFiles)
    expect(propagated).toHaveLength(0)
  })
})

describe("checkRegressionRisk", () => {
  it("detects async-related risks", () => {
    const existingFiles = ["test.ts", "test.test.ts"]
    const finding: Finding = {
      file: "test.ts",
      title: "Async change",
      issue: "Changed async function to sync - this might break callers",
      severity: "HIGH",
      verified: true,
    }
    const risk = checkRegressionRisk(finding, existingFiles)
    expect(risk.some((r) => r.includes("race conditions"))).toBe(true)
  })

  it("detects removal risks", () => {
    const existingFiles = ["test.ts", "test.test.ts"]
    const finding: Finding = {
      file: "test.ts",
      title: "Remove deprecated",
      issue: "Remove deprecated function",
      severity: "HIGH",
      verified: true,
    }
    const risk = checkRegressionRisk(finding, existingFiles)
    expect(risk.some((r) => r.includes("break dependent code"))).toBe(true)
  })
})

describe("validateFindings", () => {
  it("processes multiple findings", async () => {
    const blocks = [
      `### [HIGH] Real finding
**File:** \`test-file.ts\` (line 1)
**Issue:** This is a real and verifiable issue in the codebase
**Fix:** Apply the suggested fix`,
      `### [MEDIUM] Invalid finding
**File:** \`non-existent.ts\` (line 1)
**Issue:** This file does not exist`,
      `### [LOW] Vague finding
**File:** \`test-file.ts\`
**Issue:** might cause issues`,
    ]
    const result = await validateFindings(blocks, {
      baseDir: TEST_DIR,
      changedFiles: ["test-file.ts"],
    })
    expect(result.stats.total).toBe(3)
    expect(result.stats.valid).toBe(1)
    expect(result.stats.invalid).toBe(2)
    expect(result.invalid).toHaveLength(2)
  })

  it("reports propagation warnings", async () => {
    const blocks = [
      `### [MEDIUM] Util change
**File:** \`util/helper.ts\` (line 1)
**Issue:** Changed helper function affects other util files
**Fix:** Update calling code`,
    ]
    const result = await validateFindings(blocks, {
      baseDir: TEST_DIR,
      changedFiles: ["util/helper.ts", "util/format.ts", "util/other.ts"],
    })
    expect(result.warnings.some((w) => w.category === "propagation")).toBe(true)
  })
})

describe("formatFindingsReport", () => {
  it("formats a complete report", async () => {
    const blocks = [
      `### [HIGH] Test finding
**File:** \`test-file.ts\` (line 1)
**Issue:** This is a verified issue in the code
**Fix:** Apply the fix`,
    ]
    const result = await validateFindings(blocks, {
      baseDir: TEST_DIR,
      changedFiles: ["test-file.ts"],
    })
    const report = formatFindingsReport(result)
    expect(report).toContain("Findings Validation Report")
    expect(report).toContain("HIGH: 1")
  })
})
