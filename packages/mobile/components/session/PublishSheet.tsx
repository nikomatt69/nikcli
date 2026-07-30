import { ActivityIndicator, Animated, ScrollView, Text, View } from "react-native"
import type { Dispatch, SetStateAction } from "react"
import { useEffect } from "react"
import type { SessionDetail } from "@/lib/types"
import { ActionButton } from "@/components/ui/ActionButton"
import { SheetShell, useSheetScrollProps } from "@/components/ui/SheetShell"
import { TextField } from "@/components/ui/TextField"
import { useAnimatedValue, usePrefersReducedMotion } from "@/lib/animation"
import { useAppTheme } from "@/lib/theme"
import { caps, type as typeStyle } from "@/lib/typography"

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
  const { palette } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const sheetScroll = useSheetScrollProps()
  const pulseAnim = useAnimatedValue(1)

  useEffect(() => {
    if (publishing && !prefersReducedMotion) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      )
      pulse.start()
      return () => pulse.stop()
    } else {
      pulseAnim.setValue(1)
    }
  }, [prefersReducedMotion, publishing, pulseAnim])

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      variant="inset"
      avoidKeyboard
      accessibilityLabel="Publish workflow"
      // A drafted commit message and PR body are real work — a stray backdrop tap must not eat them.
      dismissOnBackdropPress={false}
    >
      <ScrollView style={{ width: "100%" }} {...sheetScroll}>
        <View style={{ padding: 20 }}>
          <Text style={{ ...caps(11, { weight: "700" }), color: palette.accentLight }}>Publish workflow</Text>
          <Text style={{ marginTop: 8, ...typeStyle(28, { weight: "600" }), color: palette.ink }}>
            {detail?.info.github?.pullRequest ? "Update pull request" : "Create pull request"}
          </Text>
          <Text style={{ marginTop: 12, ...typeStyle(14, { leadingScale: 1.15 }), color: palette.soft }}>
            {detail?.info.github?.pullRequest
              ? "Update the branch and commit message. Existing PR title and description stay in GitHub unless you edit them here."
              : "Set the commit, PR title, and launch notes before this session publishes back to GitHub from mobile."}
          </Text>

          <View style={{ marginTop: 16, gap: 12 }}>
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

          {/*
            These were wrapped in an outer Pressable that owned the real handler while the
            ActionButton got `onPress={() => {}}` and a hardcoded `disabled`, so Publish could
            never fire. ActionButton already carries its own press spring and disabled state.
          */}
          <View style={{ marginTop: 20, flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <ActionButton label="Cancel" variant="secondary" onPress={onClose} disabled={publishing} />
            </View>
            <View style={{ flex: 1 }}>
              <ActionButton
                label={publishing ? "Publishing…" : "Publish now"}
                loading={publishing}
                disabled={publishing || sessionBlocked || cleaned}
                onPress={onPublish}
              />
            </View>
          </View>

          {publishing ? (
            <Animated.View
              style={{
                marginTop: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                transform: [{ scale: pulseAnim }],
              }}
            >
              <ActivityIndicator color={palette.accent} size="small" />
              <Text style={{ fontSize: 14, color: palette.soft }}>Publishing changes to GitHub…</Text>
            </Animated.View>
          ) : null}
        </View>
      </ScrollView>
    </SheetShell>
  )
}
