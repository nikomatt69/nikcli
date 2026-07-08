/**
 * English string catalog for the nikcli TUI (default locale / source of truth).
 *
 * Implements `specs/opencode-parity/06-tui-i18n.md`. Keys are dotted and grouped by surface.
 * Templates use `{{param}}` interpolation. Every key here MUST exist in every other locale
 * (enforced by `test/tui/i18n-parity.test.ts`).
 */
export const en = {
  // Prompt composer placeholder examples
  "prompt.example.todo": "Find a TODO comment and fix it",
  "prompt.example.techStack": "What is the tech stack of this project?",
  "prompt.example.tests": "Fix broken tests",
  "prompt.shellExample.ls": "ls -la",
  "prompt.shellExample.gitStatus": "git status",
  "prompt.shellExample.pwd": "pwd",
  // Prompt placeholders (templated with the chosen example)
  "prompt.placeholder.ask": 'Ask anything... "{{example}}"',
  "prompt.placeholder.shell": 'Run a command... "{{example}}"',
  // Prompt footer / status row
  "prompt.shell": "Shell",
  "prompt.interrupt": "interrupt",
  "prompt.interruptAgain": "again to interrupt",
  "prompt.commands": "commands",
  "prompt.exitShellMode": "exit shell mode",
  // Session view — revert banner / redo confirm
  "session.revert.confirmTitle": "Confirm Redo",
  "session.revert.confirmBody": "Are you sure you want to restore the reverted messages?",
  "session.revert.bannerCount": "{{count}} message reverted",
  "session.revert.bannerCountPlural": "{{count}} messages reverted",
  "session.revert.bannerHint": "or /redo to restore",
  "session.message.actionsTitle": "Message Actions",
  "session.message.revert": "Revert",
  "session.message.revertDescription": "undo messages and file changes",
  "session.message.copy": "Copy",
  "session.message.copyDescription": "message text to clipboard",
  "session.message.fork": "Fork",
  "session.message.forkDescription": "create a new session",
  // Session command palette (high-traffic titles)
  "session.cmd.backgroundSubtask": "Background subtask",
  "session.cmd.backgroundAgents": "Background agents",
  "session.cmd.share": "Share session",
  "session.cmd.copyShareLink": "Copy share link",
  "session.share.copied": "Share URL copied to clipboard!",
  "session.cmd.hideSidebar": "Hide sidebar",
  "session.cmd.showSidebar": "Show sidebar",
  "session.cmd.rename": "Rename session",
  "session.cmd.jumpToMessage": "Jump to message",
  "session.cmd.forkFromMessage": "Fork from message",
  "session.cmd.compact": "Compact session",
  "session.cmd.unshare": "Unshare session",
  "session.cmd.undo": "Undo previous message",
  "session.cmd.redo": "Redo",
  "session.cmd.toggleConceal": "Toggle code concealment",
  "session.cmd.hideTimestamps": "Hide timestamps",
  "session.cmd.showTimestamps": "Show timestamps",
  "session.cmd.hideThinking": "Hide thinking",
  "session.cmd.showThinking": "Show thinking",
  "session.cmd.toggleDiffWrap": "Toggle diff wrapping",
  "session.cmd.hideToolDetails": "Hide tool details",
  "session.cmd.showToolDetails": "Show tool details",
  "session.cmd.toggleScrollbar": "Toggle session scrollbar",
  "session.cmd.disableAnimations": "Disable animations",
  "session.cmd.enableAnimations": "Enable animations",
  "session.cmd.pageUp": "Page up",
  "session.cmd.pageDown": "Page down",
  "session.cmd.lineUp": "Line up",
  "session.cmd.lineDown": "Line down",
  "session.cmd.halfPageUp": "Half page up",
  "session.cmd.halfPageDown": "Half page down",
  "session.cmd.firstMessage": "First message",
  "session.cmd.lastMessage": "Last message",
  "session.cmd.lastUserMessage": "Jump to last user message",
  "session.cmd.nextMessage": "Next message",
  "session.cmd.prevMessage": "Previous message",
  "session.cmd.copyTranscript": "Copy session transcript",
  "session.cmd.exportTranscript": "Export session transcript",
  "session.cmd.copyLastAssistant": "Copy last assistant message",
  "session.cmd.nextChild": "Next child session",
  "session.cmd.prevChild": "Previous child session",
  "session.cmd.parent": "Go to parent session",
  "session.cmd.closeSubagent": "Close subagent session",
  // Common toasts
  "toast.copied": "Copied to clipboard",
  "session.category": "Session",
} as const

export type TuiMessageKey = keyof typeof en
