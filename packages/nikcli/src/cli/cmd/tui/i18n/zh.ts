/**
 * Simplified Chinese catalog for the nikcli TUI. Validates the i18n system end to end.
 * Key set MUST match `en.ts` exactly (enforced by `test/tui/i18n-parity.test.ts`).
 */
import type { TuiMessageKey } from "./en"

export const zh: Record<TuiMessageKey, string> = {
  "prompt.example.todo": "找到一个 TODO 注释并修复它",
  "prompt.example.techStack": "这个项目的技术栈是什么？",
  "prompt.example.tests": "修复失败的测试",
  "prompt.shellExample.ls": "ls -la",
  "prompt.shellExample.gitStatus": "git status",
  "prompt.shellExample.pwd": "pwd",
  "prompt.placeholder.ask": '随便问... "{{example}}"',
  "prompt.placeholder.shell": '运行命令... "{{example}}"',
  "prompt.shell": "Shell",
  "prompt.interrupt": "中断",
  "prompt.interruptAgain": "再次按下以中断",
  "prompt.commands": "命令",
  "prompt.exitShellMode": "退出 shell 模式",
}
