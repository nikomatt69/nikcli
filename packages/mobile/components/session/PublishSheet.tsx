import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native"
import type { Dispatch, SetStateAction } from "react"
import type { SessionDetail } from "@/lib/types"
import { ActionButton } from "@/components/ui/ActionButton"
import { TextField } from "@/components/ui/TextField"
import { useAppTheme } from "@/lib/theme"

type PublishSheetProps = {
  visible: boolean
  detail: SessionDetail | null
  publishTitle: string
  setPublishTitle: Dispatch<SetStateAction<string>>
  publishBody: string
  setPublishBody: Dispatch<SetStateAction<string>>
  commitMessage: string
  setCommitMessage: Dispatch<SetStateAction<string>>
  publishing: boolean
  sessionBlocked: boolean
  cleaned: boolean
  onClose(): void
  onPublish(): void
}

export function PublishSheet({
  visible,
  detail,
  publishTitle,
  setPublishTitle,
  publishBody,
  setPublishBody,
  commitMessage,
  setCommitMessage,
  publishing,
  sessionBlocked,
  cleaned,
  onClose,
  onPublish,
}: PublishSheetProps) {
  const { palette, isDark } = useAppTheme()

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1"
        style={{ backgroundColor: isDark ? "rgba(2, 6, 23, 0.7)" : "rgba(15, 23, 42, 0.22)" }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="flex-1 items-center justify-end px-4 pb-6">
          <Pressable className="absolute inset-0" onPress={onClose} />
          <ScrollView
            className="w-full max-h-[88%]"
            contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
          >
            <View className="w-full rounded-[34px] border border-border bg-surface px-5 py-5">
              <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">
                Publish workflow
              </Text>
              <Text className="mt-2 text-[28px] font-semibold leading-[32px] text-ink">
                {detail?.info.github?.pullRequest ? "Update pull request" : "Create pull request"}
              </Text>
              <Text className="mt-3 text-sm leading-6 text-soft">
                {detail?.info.github?.pullRequest
                  ? "Update the branch and commit message. Existing PR title and description stay in GitHub unless you edit them here."
                  : "Set the commit, PR title, and launch notes before this session publishes back to GitHub from mobile."}
              </Text>

              <View className="mt-4 gap-3">
                <TextField
                  label="Commit message"
                  value={commitMessage}
                  onChangeText={setCommitMessage}
                  placeholder="Commit message"
                />
                {!detail?.info.github?.pullRequest ? (
                  <>
                    <TextField
                      label="Pull request title"
                      value={publishTitle}
                      onChangeText={setPublishTitle}
                      placeholder="Pull request title"
                    />
                    <TextField
                      label="Pull request body"
                      value={publishBody}
                      onChangeText={setPublishBody}
                      multiline
                      placeholder="Pull request body"
                    />
                  </>
                ) : null}
              </View>

              <View className="mt-5 flex-row gap-2">
                <View className="flex-1">
                  <ActionButton label="Cancel" variant="secondary" onPress={onClose} />
                </View>
                <View className="flex-1">
                  <ActionButton
                    label="Publish now"
                    disabled={publishing || sessionBlocked || cleaned}
                    onPress={onPublish}
                  />
                </View>
              </View>

              {publishing ? (
                <View className="mt-3 flex-row items-center gap-2">
                  <ActivityIndicator color={palette.accent} size="small" />
                  <Text className="text-sm text-soft">Publishing changes to GitHub…</Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
