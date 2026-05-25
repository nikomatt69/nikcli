import path from "path"
import fs from "fs/promises"
import { Log } from "@/util/log"

const log = Log.create({ service: "findings" })

/**
 * Severity levels for code findings
 */
export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"

/**
 * A validated finding with structured information
 */
export interface Finding {
  /** Relative or absolute file path */
  file: string
  /** Optional line number reference */
  line?: number
  /** Finding title */
  title: string
  /** Detailed issue description */
  issue: string
  /** Suggested fix */
  fix?: string
  /** Severity level */
  severity: FindingSeverity
  /** Whether the finding was verified to be real */
  verified: boolean
  /** Optional evidence or references */
  evidence?: string[]
}

/**
 * Validation result for a finding
 */
export interface ValidationResult {
  /** Whether this finding passes validation */
  valid: boolean
  /** The validated finding or undefined if invalid */
  finding?: Finding
  /** Validation errors/warnings */
  issues: string[]
}

/**
 * Parse a markdown finding into structured format
 *
 * Expects format:
 * ### [SEVERITY] Title
 * **File:** `path/to/file.ts` (line N)
 * **Issue:** Description
 * **Fix:** Optional fix suggestion
 */
export function parseFinding(block: string): Finding | undefined {
  // Extract severity and title
  const severityMatch = block.match(/^###\s*\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]\s*(.+)$/im)
  if (!severityMatch) return undefined

  const severity = severityMatch[1] as FindingSeverity
  const title = severityMatch[2].trim()

  // Extract file with optional line number
  const fileMatch = block.match(/\*\*File:\*\*\s*`([^`]+)`(?:\s*\(line\s*(\d+)\))?/i)
  if (!fileMatch) return undefined

  const file = fileMatch[1].trim()
  const line = fileMatch[2] ? parseInt(fileMatch[2], 10) : undefined

  // Extract issue description
  const issueMatch = block.match(/\*\*Issue:\*\*\s*(.+?)(?=\n\n|\n\*\*|$)/is)
  if (!issueMatch) return undefined
  const issue = issueMatch[1].trim()

  // Extract optional fix
  const fixMatch = block.match(/\*\*Fix:\*\*\s*(.+?)(?=\n\n|\n\*\*|$)/is)
  const fix = fixMatch ? fixMatch[1].trim() : undefined

  return { file, line, title, issue, fix, severity, verified: false }
}

/**
 * Check if a file path from a finding is real and accessible
 */
export async function isFileReal(filePath: string, baseDir: string): Promise<boolean> {
  try {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath)
    await fs.access(resolved)
    return true
  } catch {
    return false
  }
}

/**
 * Check file referenced in finding actually exists and is accessible
 * Also validates line numbers if provided
 */
export async function validateFindingReal(finding: Finding, baseDir: string): Promise<ValidationResult> {
  const issues: string[] = []

  // Resolve the file path
  const resolvedPath = path.isAbsolute(finding.file) ? finding.file : path.resolve(baseDir, finding.file)

  // Check if file exists
  let fileExists = false
  try {
    await fs.access(resolvedPath)
    fileExists = true
  } catch {
    issues.push(`File does not exist: ${finding.file}`)
  }

  // If file exists and line number provided, validate line range
  if (fileExists && finding.line !== undefined) {
    try {
      const stat = await fs.stat(resolvedPath)
      if (stat.isFile()) {
        const content = await fs.readFile(resolvedPath, "utf8")
        const lineCount = content.split("\n").length
        if (finding.line < 1 || finding.line > lineCount) {
          issues.push(`Line ${finding.line} is out of range (file has ${lineCount} lines)`)
        }
      }
    } catch (err) {
      issues.push(`Could not read file to validate line: ${err}`)
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    finding: { ...finding, verified: true },
    issues: [],
  }
}

/**
 * Validate that a finding's issue description is logical
 * Checks for common logic issues that indicate speculative findings
 */
export function validateFindingLogical(finding: Finding, diffContent?: string): ValidationResult {
  const issues: string[] = []

  // Check issue description is substantive
  if (!finding.issue || finding.issue.length < 10) {
    issues.push("Issue description is too short or empty - may be speculative")
  }

  // Check for overly vague language that suggests speculation
  const vagueIndicators = [
    /\bmight\b/i,
    /\bcould\s+possibly\b/i,
    /\bmaybe\b/i,
    /\bperhaps\b/i,
    /\bpossibly\s+be\b/i,
    /\bthis\s+could\s+cause\b/i,
    /\bsome\s+(issues?|problems?)\b/i,
    /\bare\s+not\s+ideal\b/i,
    /\bnot\s+optimal\b/i,
  ]

  for (const pattern of vagueIndicators) {
    if (pattern.test(finding.issue)) {
      issues.push(`Issue contains vague language suggesting speculation: "${pattern.toString()}"`)
    }
  }

  // Check for fix suggestion in issue (good practice)
  if (!finding.fix && (finding.severity === "CRITICAL" || finding.severity === "HIGH")) {
    issues.push("High-severity finding lacks a fix suggestion")
  }

  // Validate against diff content if provided
  if (diffContent) {
    const fileName = path.basename(finding.file)
    const fileMentioned = diffContent.includes(fileName)
    if (!fileMentioned) {
      issues.push(`File "${fileName}" is not in the diff being reviewed`)
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    finding: { ...finding, verified: true },
    issues: [],
  }
}

/**
 * Check if this finding would require checking other files (propagation)
 * Returns list of files that might need checking
 */
export function findPropagationFiles(finding: Finding, _baseDir: string, knownChangedFiles: string[]): string[] {
  const propagationTriggers = [
    /util\//,
    /lib\//,
    /common\//,
    /shared\//,
    /base\//,
    /core\//,
    /\.config\./,
    /config\//,
    /types?\//,
    /\.d\.ts/,
    /interface\./,
    /base\./,
  ]

  const trigger = propagationTriggers.find((regex) => regex.test(finding.file))
  if (!trigger) return []

  // Extract the trigger pattern and build regex to match same directory
  const source = trigger.source
  const triggerStr = source.replace(/\\\//, "/").replace(/\\\\/g, "\\").replace(/\$$\//, "").replace(/^\^/, "")
  const triggerRegex = new RegExp(triggerStr, "i")

  // Find other files in the same directory that might be affected
  const potentiallyAffected = knownChangedFiles.filter((f) => triggerRegex.test(f) && f !== finding.file)

  return potentiallyAffected
}

/**
 * Check if this finding might cause regressions
 * Returns warnings about potential side effects
 */
export function checkRegressionRisk(finding: Finding, existingFiles: string[]): string[] {
  const warnings: string[] = []

  // High-risk patterns that might cause regressions
  const regressionPatterns = [
    {
      pattern: /memory\s*leak/i,
      concern: "Memory leak fixes might introduce new allocation issues",
    },
    {
      pattern: /async|await|promise/i,
      concern: "Async changes might cause race conditions in dependent code",
    },
    {
      pattern: /remove|delete|deprecate/i,
      concern: "Removals might break dependent code",
    },
    {
      pattern: /change.*api|interface.*change|contract/i,
      concern: "API changes might break external consumers",
    },
    {
      pattern: /concurrent|parallel|thread/i,
      concern: "Concurrency changes might introduce deadlocks or race conditions",
    },
  ]

  for (const { pattern, concern } of regressionPatterns) {
    if (pattern.test(finding.issue)) {
      warnings.push(concern)
    }
  }

  // Check if related files exist that might be affected
  const fileName = path.basename(finding.file, path.extname(finding.file))
  const relatedFiles = existingFiles.filter(
    (f) => f.includes(fileName) && f !== finding.file && !f.endsWith(".test.ts") && !f.endsWith(".spec.ts"),
  )

  if (relatedFiles.length > 5) {
    warnings.push(`Many related files exist - ensure compatibility across ${relatedFiles.length} related files`)
  }

  return warnings
}

/**
 * Full validation pipeline for findings
 */
export interface FindingsValidationOptions {
  /** Working directory for file resolution */
  baseDir: string
  /** Files changed in this review */
  changedFiles?: string[]
  /** Diff content for logical validation */
  diffContent?: string
  /** Enable strict mode (fail on warnings) */
  strict?: boolean
}

export interface FindingsValidationReport {
  /** All findings after validation */
  findings: Finding[]
  /** Invalid findings that were filtered */
  invalid: { finding: Finding; issues: string[] }[]
  /** Integration warnings (propagations, regressions) */
  warnings: { finding: Finding; category: string; message: string }[]
  /** Summary statistics */
  stats: {
    total: number
    valid: number
    invalid: number
    bySeverity: Record<FindingSeverity, number>
  }
}

export async function validateFindings(
  findingBlocks: string[],
  options: FindingsValidationOptions,
): Promise<FindingsValidationReport> {
  const { baseDir, changedFiles = [], diffContent } = options

  // First pass: parse all findings
  const parsedFindings = findingBlocks.map((block) => parseFinding(block)).filter((f): f is Finding => f !== undefined)

  const valid: Finding[] = []
  const invalid: { finding: Finding; issues: string[] }[] = []
  const warnings: { finding: Finding; category: string; message: string }[] = []

  for (const finding of parsedFindings) {
    const allIssues: string[] = []

    // 1. Check if the finding is real (file exists, line valid)
    const realCheck = await validateFindingReal(finding, baseDir)
    if (!realCheck.valid) {
      allIssues.push(...realCheck.issues)
    }

    // 2. Check if the finding is logical (not speculative)
    if (realCheck.valid) {
      const logicalCheck = validateFindingLogical(finding, diffContent)
      if (!logicalCheck.valid) {
        allIssues.push(...logicalCheck.issues)
      }
    }

    // 3. Check for propagation requirements
    const propagated = findPropagationFiles(finding, baseDir, changedFiles)
    if (propagated.length > 0) {
      warnings.push({
        finding,
        category: "propagation",
        message: `This change may affect ${propagated.length} related files: ${propagated.slice(0, 3).join(", ")}${propagated.length > 3 ? "..." : ""}`,
      })
    }

    // 4. Check for regression risk
    const regressionWarnings = checkRegressionRisk(finding, changedFiles)
    for (const warning of regressionWarnings) {
      warnings.push({
        finding,
        category: "regression",
        message: warning,
      })
    }

    // Determine validity
    if (allIssues.length > 0) {
      invalid.push({ finding, issues: allIssues })
    } else {
      valid.push(realCheck.finding!)
    }
  }

  // Calculate statistics
  const bySeverity = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  } as Record<FindingSeverity, number>

  for (const finding of valid) {
    bySeverity[finding.severity]++
  }

  return {
    findings: valid,
    invalid,
    warnings,
    stats: {
      total: parsedFindings.length,
      valid: valid.length,
      invalid: invalid.length,
      bySeverity,
    },
  }
}

/**
 * Format validation report for display
 */
export function formatFindingsReport(report: FindingsValidationReport): string {
  const lines: string[] = []

  lines.push("## Findings Validation Report")
  lines.push("")
  lines.push("### Summary")
  lines.push(`Total found: ${report.stats.total}`)
  lines.push(`Valid: ${report.stats.valid}`)
  lines.push(`Invalid: ${report.stats.invalid}`)
  lines.push("")
  lines.push("By severity:")
  lines.push(`- CRITICAL: ${report.stats.bySeverity.CRITICAL}`)
  lines.push(`- HIGH: ${report.stats.bySeverity.HIGH}`)
  lines.push(`- MEDIUM: ${report.stats.bySeverity.MEDIUM}`)
  lines.push(`- LOW: ${report.stats.bySeverity.LOW}`)

  if (report.invalid.length > 0) {
    lines.push("")
    lines.push("### Invalid Findings (filtered)")
    for (const { finding, issues } of report.invalid) {
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.file})`)
      for (const issue of issues) {
        lines.push(`  - ${issue}`)
      }
    }
  }

  if (report.warnings.length > 0) {
    lines.push("")
    lines.push("### Integration Warnings")
    for (const { finding, category, message } of report.warnings) {
      lines.push(`- [${category}] ${finding.title}: ${message}`)
    }
  }

  return lines.join("\n")
}
