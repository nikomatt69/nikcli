import { For, Show } from "solid-js"
import type {
  Message,
  Part,
  ToolPart,
  FilePart,
  PatchPart,
  SnapshotPart,
  ReasoningPart,
  StepStartPart,
  StepFinishPart,
  AgentPart,
  RetryPart,
  CompactionPart,
} from "@nikcli-ai/sdk/v2"
import { useI18n } from "../../i18n"
import { useSession, usePrompt } from "../../context"
import { formatDate } from "../../lib/utils"

export default function MainContent() {
  const { t } = useI18n()
  const { activeSession, createSession } = useSession()
  const { messages, isProcessing } = usePrompt()
  const session = activeSession()

  if (!session) {
    return (
      <div class="flex-1 overflow-auto p-4 bg-white dark:bg-gray-950">
        <div class="h-full flex flex-col items-center justify-center text-gray-500">
          <p class="mb-4">{t("session.noActiveSession")}</p>
          <button
            class="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
            onClick={() => createSession()}
          >
            {t("sidebar.newSession")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div class="flex-1 overflow-auto p-4 bg-white dark:bg-gray-950">
      <Show when={messages().length > 0} fallback={<EmptyState loading={isProcessing()} />}>
        <div class="flex flex-col gap-4">
          <For each={messages()}>{(message) => <MessageCard message={message} />}</For>
        </div>
      </Show>
    </div>
  )
}

function EmptyState(props: { loading: boolean }) {
  const { t } = useI18n()
  return (
    <div class="h-full flex flex-col items-center justify-center text-gray-500">
      <p class="mb-2">{t("session.editorPlaceholder")}</p>
      <p class="text-sm">{props.loading ? t("prompt.processing") : t("session.startPrompt")}</p>
    </div>
  )
}

type MessageItem = {
  info: Message
  parts: Part[]
}

function MessageCard(props: { message: MessageItem }) {
  const isUser = () => props.message.info.role === "user"
  const issue = () => (props.message.info.role === "assistant" ? props.message.info.error : undefined)
  return (
    <div class={`flex ${isUser() ? "justify-end" : "justify-start"}`}>
      <div
        class={`max-w-3xl w-full rounded-xl border px-4 py-3 shadow-sm ${
          isUser()
            ? "bg-blue-600 text-white border-blue-600"
            : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
        }`}
      >
        <div class={`text-xs mb-3 ${isUser() ? "text-blue-100" : "text-gray-400"}`}>
          <span class="font-semibold">{isUser() ? "You" : "NikCLI"}</span>
          <span class="mx-2">•</span>
          <span>{formatDate(new Date(props.message.info.time.created))}</span>
        </div>
        <div class={`space-y-3 ${isUser() ? "text-white" : "text-gray-900 dark:text-gray-100"}`}>
          <Show when={issue()}>
            <pre
              class={`rounded-lg p-3 text-xs whitespace-pre-wrap ${
                isUser() ? "bg-blue-500/60" : "bg-red-50 text-red-600 dark:bg-red-900/20"
              }`}
            >
              {JSON.stringify(issue(), null, 2)}
            </pre>
          </Show>
          <For each={props.message.parts}>{(part) => <PartView part={part} inverted={isUser()} />}</For>
        </div>
      </div>
    </div>
  )
}

function PartView(props: { part: Part; inverted: boolean }) {
  if (props.part.type === "text") {
    return <p class="whitespace-pre-wrap leading-relaxed">{props.part.text}</p>
  }

  if (props.part.type === "tool") {
    return <ToolView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "file") {
    return <FileView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "patch") {
    return <PatchView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "snapshot") {
    return <SnapshotView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "reasoning") {
    return <ReasoningView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "step-start") {
    return <StepStartView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "step-finish") {
    return <StepFinishView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "agent") {
    return <AgentView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "retry") {
    return <RetryView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "compaction") {
    return <CompactionView part={props.part} inverted={props.inverted} />
  }

  if (props.part.type === "subtask") {
    return <SubtaskView part={props.part} inverted={props.inverted} />
  }

  return (
    <pre
      class={`rounded-lg p-3 text-xs whitespace-pre-wrap ${props.inverted ? "bg-blue-500/60" : "bg-gray-100 dark:bg-gray-800"}`}
    >
      {JSON.stringify(props.part, null, 2)}
    </pre>
  )
}

function ToolView(props: { part: ToolPart; inverted: boolean }) {
  const status = () => props.part.state.status
  const title = () => {
    if (props.part.state.status === "running" && props.part.state.title) return props.part.state.title
    if (props.part.state.status === "completed") return props.part.state.title
    return status()
  }
  const output = () => (props.part.state.status === "completed" ? props.part.state.output : "")
  const error = () => (props.part.state.status === "error" ? props.part.state.error : "")
  const raw = () => (props.part.state.status === "pending" ? props.part.state.raw : "")

  return (
    <div
      class={`rounded-lg border p-3 ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="flex items-center justify-between text-sm font-semibold">
        <span>{props.part.tool}</span>
        <span class="uppercase text-xs tracking-wide">{status()}</span>
      </div>
      <Show when={title()}>
        <p class="mt-1 text-xs opacity-80">{title()}</p>
      </Show>
      <Show when={raw()}>
        <pre class="mt-2 text-xs whitespace-pre-wrap">{raw()}</pre>
      </Show>
      <Show when={output()}>
        <pre class="mt-2 text-xs whitespace-pre-wrap">{output()}</pre>
      </Show>
      <Show when={error()}>
        <pre class="mt-2 text-xs whitespace-pre-wrap text-red-200">{error()}</pre>
      </Show>
    </div>
  )
}

function FileView(props: { part: FilePart; inverted: boolean }) {
  const name = () => props.part.filename || props.part.url
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">{name()}</div>
      <div class="text-xs opacity-70">{props.part.mime}</div>
      <a class="text-xs underline" href={props.part.url} target="_blank" rel="noreferrer">
        {props.part.url}
      </a>
    </div>
  )
}

function PatchView(props: { part: PatchPart; inverted: boolean }) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Patch</div>
      <ul class="mt-2 list-disc list-inside text-xs space-y-1">
        <For each={props.part.files}>{(file) => <li>{file}</li>}</For>
      </ul>
    </div>
  )
}

function SnapshotView(props: { part: SnapshotPart; inverted: boolean }) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Snapshot</div>
      <pre class="mt-2 text-xs whitespace-pre-wrap max-h-64 overflow-auto">{props.part.snapshot}</pre>
    </div>
  )
}

function ReasoningView(props: { part: ReasoningPart; inverted: boolean }) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Reasoning</div>
      <p class="mt-2 text-xs whitespace-pre-wrap">{props.part.text}</p>
    </div>
  )
}

function StepStartView(props: { part: StepStartPart; inverted: boolean }) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Step started</div>
      <Show when={props.part.snapshot}>
        <div class="mt-2 text-xs">Snapshot: {props.part.snapshot}</div>
      </Show>
    </div>
  )
}

function StepFinishView(props: { part: StepFinishPart; inverted: boolean }) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Step finished</div>
      <div class="mt-1 text-xs">Reason: {props.part.reason}</div>
      <div class="text-xs">Cost: {props.part.cost}</div>
    </div>
  )
}

function AgentView(props: { part: AgentPart; inverted: boolean }) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Agent</div>
      <div class="mt-1 text-xs">{props.part.name}</div>
    </div>
  )
}

function RetryView(props: { part: RetryPart; inverted: boolean }) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Retry</div>
      <div class="mt-1 text-xs">Attempt: {props.part.attempt}</div>
      <pre class="mt-2 text-xs whitespace-pre-wrap">{JSON.stringify(props.part.error, null, 2)}</pre>
    </div>
  )
}

function CompactionView(props: { part: CompactionPart; inverted: boolean }) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Compaction</div>
      <div class="mt-1 text-xs">Auto: {props.part.auto ? "true" : "false"}</div>
    </div>
  )
}

function SubtaskView(props: {
  part: { type: "subtask"; prompt: string; description: string; agent: string }
  inverted: boolean
}) {
  return (
    <div
      class={`rounded-lg border p-3 text-sm ${props.inverted ? "border-blue-400/40 bg-blue-500/30" : "border-gray-200 dark:border-gray-800"}`}
    >
      <div class="font-semibold">Subtask</div>
      <div class="mt-1 text-xs">Agent: {props.part.agent}</div>
      <div class="mt-1 text-xs">{props.part.description}</div>
      <pre class="mt-2 text-xs whitespace-pre-wrap">{props.part.prompt}</pre>
    </div>
  )
}
