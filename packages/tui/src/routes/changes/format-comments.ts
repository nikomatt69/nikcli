import type { Comment } from "./comment-box"

export type CommentsByFile = Map<string, Map<string, Comment>>

export function hasAnyComments(commentsByFile: CommentsByFile): boolean {
  for (const comments of commentsByFile.values()) {
    if (comments.size > 0) return true
  }
  return false
}

export function formatCommentsForAI(commentsByFile: CommentsByFile): string {
  const sections = Array.from(commentsByFile.entries())
    .filter(([, comments]) => comments.size > 0)
    .map(([filePath, comments]) => formatFileSection(filePath, comments))
    .filter(Boolean)

  if (sections.length === 0) return ""

  return [
    "Code Review Feedback",
    "",
    "I reviewed the changes and have the following line-level feedback:",
    "",
    ...sections,
  ].join("\n")
}

function formatFileSection(filePath: string, comments: Map<string, Comment>): string {
  const items = Array.from(comments.values())
    .sort((a, b) => a.line - b.line)
    .map(formatComment)
    .filter(Boolean)

  if (items.length === 0) return ""
  return [`## ${filePath}`, "", ...items].join("\n")
}

function formatComment(comment: Comment): string {
  const typeTag = comment.type ? ` [${comment.type}]` : ""
  return [`### ${formatLineInfo(comment)}${formatTypeLabel(comment.lineType)}${typeTag}`, comment.text, ""].join("\n")
}

function formatLineInfo(comment: Comment): string {
  if (comment.anchor.startsWith("old:")) return `Line ${comment.anchor.slice(4)} (old)`
  if (comment.anchor.startsWith("new:")) return `Line ${comment.anchor.slice(4)} (new)`
  if (comment.anchor.startsWith("ln:")) return `Line ${comment.anchor.slice(3)}`
  return comment.label || `Visual line ${comment.line + 1}`
}

function formatTypeLabel(lineType: Comment["lineType"]): string {
  if (lineType === "add") return " - added"
  if (lineType === "remove") return " - removed"
  return " - context"
}
