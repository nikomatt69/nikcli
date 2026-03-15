import { Pressable, Text, TextInput, View, useWindowDimensions } from "react-native"
import { ActionButton } from "@/components/ui/ActionButton"

type SessionComposerProps = {
  mode: "plan" | "code"
  setMode(mode: "plan" | "code"): void
  input: string
  setInput(value: string): void
  sending: boolean
  sessionBlocked: boolean
  cleaned: boolean
  onSend(): void
}

export function SessionComposer({
  mode,
  setMode,
  input,
  setInput,
  sending,
  sessionBlocked,
  cleaned,
  onSend,
}: SessionComposerProps) {
  const { width } = useWindowDimensions()
  const compact = width < 390
  const statusTone = cleaned ? "text-rose-300" : sessionBlocked ? "text-amber-200" : "text-emerald-200"
  const modeSummary =
    mode === "plan"
      ? "Returns analysis first and avoids direct edits."
      : "Allows direct inspection, edits, and publish work."
  const disabledReason = cleaned
    ? "This GitHub worktree is read-only after cleanup."
    : sessionBlocked
      ? "Execution is still active. Wait until the session returns idle."
      : !input.trim()
        ? mode === "plan"
          ? "Add the planning request you want reviewed first."
          : "Add the coding instruction you want to send."
        : null
  const liveHint = disabledReason ?? modeSummary

  return (
    <View className="border-t border-border bg-background px-4 pb-3 pt-2">
      <View className="rounded-[22px] border border-border bg-surface px-3 py-2.5">
        <View className={`items-start gap-2 ${compact ? "" : "flex-row justify-between"}`}>
          <View className="min-w-0 flex-1 gap-1.5">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[10px] font-semibold uppercase tracking-[1.7px] text-accent-light">Composer</Text>
              <View
                className={`rounded-full border px-2.5 py-1 ${mode === "plan" ? "border-border bg-panel" : "border-accent/20 bg-accent/10"}`}
              >
                <Text
                  className={`text-[10px] font-semibold uppercase tracking-[1.4px] ${mode === "plan" ? "text-ink" : "text-accent-light"}`}
                >
                  {mode === "plan" ? "Plan first" : "Code ready"}
                </Text>
              </View>
              <Text className={`text-[10px] font-semibold ${statusTone}`}>
                {cleaned ? "Read-only" : sessionBlocked ? "Busy" : "Ready"}
              </Text>
            </View>
            <Text className="text-[11px] leading-4 text-soft" numberOfLines={2}>
              {modeSummary}
            </Text>
          </View>

          <View className="self-start rounded-full border border-border bg-background/85 p-1">
            <View className="flex-row items-center">
              <Pressable
                onPress={() => setMode("plan")}
                className={`rounded-full px-3 py-1.5 ${mode === "plan" ? "bg-panel" : "bg-transparent"}`}
              >
                <Text className={`text-[12px] font-semibold ${mode === "plan" ? "text-ink" : "text-soft"}`}>Plan</Text>
              </Pressable>
              <Pressable
                onPress={() => setMode("code")}
                className={`rounded-full px-3 py-1.5 ${mode === "code" ? "bg-accent" : "bg-transparent"}`}
              >
                <Text className={`text-[12px] font-semibold ${mode === "code" ? "text-slate-950" : "text-soft"}`}>
                  Code
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View className={`mt-2.5 items-end gap-2 ${compact ? "" : "flex-row"}`}>
          <View className="min-w-0 flex-1 rounded-[18px] border border-border bg-background px-3 py-2.5">
            <TextInput
              value={input}
              onChangeText={setInput}
              multiline
              editable={!cleaned}
              selectionColor="#7dd3fc"
              keyboardAppearance="dark"
              placeholder={
                cleaned
                  ? "This GitHub worktree has been cleaned up."
                  : mode === "plan"
                    ? "Ask for the exact plan you want before editing..."
                    : "Ask Nikcli to inspect, edit, review, or publish..."
              }
              placeholderTextColor="#6d84a0"
              className="max-h-24 min-h-[56px] text-[15px] leading-5 text-ink"
              textAlignVertical="top"
            />
          </View>
          <View className={compact ? "w-full" : "w-[110px]"}>
            <ActionButton
              label="Send"
              loading={sending}
              disabled={sending || sessionBlocked || cleaned || !input.trim()}
              className="rounded-[18px] px-4 py-3"
              onPress={onSend}
            />
          </View>
        </View>

        <View className="mt-2 flex-row items-start justify-between gap-3">
          <Text className="min-w-0 flex-1 text-[10px] leading-4 text-soft" numberOfLines={2}>
            {liveHint}
          </Text>
          <Text className="text-[10px] text-soft" style={{ fontVariant: ["tabular-nums"] }}>
            {input.trim().length} chars
          </Text>
        </View>
      </View>
    </View>
  )
}
