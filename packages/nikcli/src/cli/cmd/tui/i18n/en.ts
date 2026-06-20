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
} as const

export type TuiMessageKey = keyof typeof en
