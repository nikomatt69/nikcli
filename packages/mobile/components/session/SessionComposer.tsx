import { Pressable, Text, TextInput, View } from "react-native"
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
  return (
    <View className="border-t border-border px-4 pb-4 pt-2">
      <View className="rounded-[26px] border border-border bg-surface px-3 py-3">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 pr-2">
            <Text className="text-[10px] font-semibold uppercase tracking-[1.8px] text-accent-light">
              Command composer
            </Text>
            <Text className="mt-0.5 text-[12px] leading-4 text-soft">
              {cleaned
                ? "This worktree is read-only after cleanup."
                : mode === "plan"
                  ? "Plan mode asks for analysis before code changes."
                  : "Code mode sends your request directly to Nikcli."}
            </Text>
          </View>
          <View className="flex-row gap-1.5 rounded-full border border-border bg-background/70 p-1">
            <Pressable
              onPress={() => setMode("plan")}
              className={`rounded-full px-3 py-1.5 ${mode === "plan" ? "bg-background" : "bg-transparent"}`}
            >
              <Text className={`font-semibold ${mode === "plan" ? "text-ink" : "text-soft"}`}>Plan</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("code")}
              className={`rounded-full px-3 py-1.5 ${mode === "code" ? "bg-accent" : "bg-transparent"}`}
            >
              <Text className={`font-semibold ${mode === "code" ? "text-slate-950" : "text-soft"}`}>Code</Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-3 rounded-[22px] border border-border bg-background px-3 py-3">
          <TextInput
            value={input}
            onChangeText={setInput}
            multiline
            editable={!cleaned}
            placeholder={
              cleaned
                ? "This GitHub worktree has been cleaned up."
                : mode === "plan"
                  ? "Ask for a plan before coding..."
                  : "Ask Nikcli to inspect, edit, review..."
            }
            placeholderTextColor="#6d84a0"
            className="max-h-24 min-h-[68px] text-[15px] leading-5 text-ink"
            textAlignVertical="top"
          />
        </View>

        <View className="mt-3 flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-[10px] leading-4 text-soft">
            {sessionBlocked
              ? "Execution is active until the session returns idle."
              : "Tools, diffs, and approvals stream inline."}
          </Text>
          <View className="w-[118px]">
            <ActionButton
              label="Send"
              loading={sending}
              disabled={sending || sessionBlocked || cleaned || !input.trim()}
              className="rounded-[20px] px-4 py-3"
              onPress={onSend}
            />
          </View>
        </View>
      </View>
    </View>
  )
}
