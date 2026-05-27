import { For, Show, createSignal, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme, sparklineChars, progressBar } from "../theme"
import { short, relativeTime, suiteStatusIcon, fmtDuration, type SuiteFileState } from "../types"

interface SuiteDetailPanelProps {
  file: SuiteFileState | undefined
  width: number
  onRunFile: (fp: string) => void
  onClearHistory: () => void
}

export function SuiteDetailPanel(props: SuiteDetailPanelProps) {
  const [showCases, setShowCases] = createSignal(true)
  const [showHistory, setShowHistory] = createSignal(true)
  const [showErrors, setShowErrors] = createSignal(true)

  const file = () => props.file
  const lr = () => file()?.lastRun

  const failedCases = createMemo(() => lr()?.cases.filter((c) => c.status === "fail") ?? [])
  const history = createMemo(() => file()?.history ?? [])
  const durations = createMemo(() => history().map((h) => h.durationMs))
  const passRates = createMemo(() => history().map((h) => h.totalTests > 0 ? h.passed / h.totalTests : 0))

  return (
    <scrollbox
      flexGrow={1}
      focusable
      rootOptions={{ flexDirection: "column" }}
      contentOptions={{ flexDirection: "column", gap: 0 }}
      scrollbarOptions={{ visible: true }}
    >
      <Show when={file()} fallback={
        <text fg={theme.textMuted} wrapMode="none">Select a test file in the tree.</text>
      }>
        <text fg={theme.blue} attributes={TextAttributes.BOLD} wrapMode="none">
          {suiteStatusIcon((lr()?.status as never) ?? "notrun")} {file()!.fileName}
        </text>
        <text fg={theme.textMuted} wrapMode="none">{short(file()!.relativePath, props.width - 4)}</text>

        <text fg={theme.textMuted} wrapMode="none"> </text>

        <Show when={lr()} fallback={
          <text fg={theme.textMuted} wrapMode="none">Never run. Press Enter to run.</text>
        }>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">Last Run</text>
          <text fg={theme.success} wrapMode="none">  ✓ {lr()!.passed} pass</text>
          <Show when={lr()!.failed > 0}>
            <text fg={theme.error} wrapMode="none">  ✗ {lr()!.failed} fail</text>
          </Show>
          <Show when={lr()!.skipped > 0}>
            <text fg={theme.textMuted} wrapMode="none">  ○ {lr()!.skipped} skip</text>
          </Show>
          <Show when={lr()!.todo > 0}>
            <text fg={theme.purple} wrapMode="none">  ◇ {lr()!.todo} todo</text>
          </Show>
          <text fg={theme.textMuted} wrapMode="none">  ⌛ {fmtDuration(lr()!.durationMs)}</text>
          <text fg={theme.textMuted} wrapMode="none">  {relativeTime(new Date(lr()!.startedAt).toISOString())} ago</text>
          <Show when={lr()!.totalTests > 0}>
            <text fg={theme.success} wrapMode="none">
              {progressBar(lr()!.passed, lr()!.totalTests, Math.min(20, props.width - 4))}
            </text>
          </Show>
        </Show>

        <text fg={theme.textMuted} wrapMode="none"> </text>

        <text
          fg={theme.error}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          onMouseUp={() => setShowErrors((v) => !v)}
        >
          {showErrors() ? "▼" : "▶"} Failures ({failedCases().length})
        </text>
        <Show when={showErrors() && failedCases().length > 0}>
          <For each={failedCases().slice(0, 8)}>
            {(c) => (
              <text fg={theme.error} wrapMode="none">
                ✗ {short(c.name, props.width - 4)}
              </text>
            )}
          </For>
        </Show>

        <text fg={theme.textMuted} wrapMode="none"> </text>

        <text
          fg={theme.text}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          onMouseUp={() => setShowCases((v) => !v)}
        >
          {showCases() ? "▼" : "▶"} Cases ({lr()?.cases.length ?? 0})
        </text>
        <Show when={showCases()}>
          <For each={(lr()?.cases ?? []).slice(0, 10)}>
            {(c) => {
              const color = c.status === "pass" ? theme.success : c.status === "fail" ? theme.error : theme.textMuted
              const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : c.status === "skip" ? "○" : "◇"
              return (
                <text fg={color} wrapMode="none">
                  {icon} {short(c.name, props.width - 4)}
                </text>
              )
            }}
          </For>
        </Show>

        <text fg={theme.textMuted} wrapMode="none"> </text>

        <text
          fg={theme.purple}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          onMouseUp={() => setShowHistory((v) => !v)}
        >
          {showHistory() ? "▼" : "▶"} History ({history().length})
        </text>
        <Show when={showHistory() && history().length >= 2}>
          <text fg={theme.purple} wrapMode="none">  dur:  {sparklineChars(durations(), Math.min(20, props.width - 8))}</text>
          <text fg={theme.success} wrapMode="none">  pass: {sparklineChars(passRates(), Math.min(20, props.width - 8))}</text>
        </Show>
        <Show when={showHistory()}>
          <For each={history().slice(-5).reverse()}>
            {(h) => {
              const color = h.status === "fail" ? theme.error : h.status === "pass" ? theme.success : theme.textMuted
              return (
                <text fg={color} wrapMode="none">
                  {suiteStatusIcon(h.status)} {relativeTime(new Date(h.startedAt).toISOString()).padStart(4)} {fmtDuration(h.durationMs).padStart(7)} {h.passed}p/{h.failed}f
                </text>
              )
            }}
          </For>
        </Show>

        <text fg={theme.textMuted} wrapMode="none"> </text>
        <text
          fg={theme.accent}
          attributes={TextAttributes.BOLD}
          wrapMode="none"
          onMouseUp={() => file() && props.onRunFile(file()!.filePath)}
        >
          [ ↵ Run File ]
        </text>
        <text
          fg={theme.warning}
          wrapMode="none"
          onMouseUp={props.onClearHistory}
        >
          [ ⌫ Clear History ]
        </text>
      </Show>
    </scrollbox>
  )
}
