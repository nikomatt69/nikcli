import { Divider, HStack, Image, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui"
import {
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  activityBackgroundTint,
  background,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers"
import type { LiveActivity } from "expo-widgets"

export type SessionLiveActivityProps = {
  sessionID: string
  status: string
  action: string
  repository: string
  branch: string
  startedAt: number
  timerEndsAt?: number
  attention: boolean
  reviewURL: string
  approveURL?: string
  stopURL?: string
}

export type SessionLiveActivityHandle = LiveActivity<SessionLiveActivityProps>

const SessionActivity = (props: SessionLiveActivityProps) => {
  "widget"

  const accent = props.attention ? "#FFB340" : "#A8A8A8"
  const secondary = "#A1A1A6"
  const tertiary = "#6E6E73"
  const timerDate = new Date(props.timerEndsAt ?? props.startedAt)
  const timerLabel = props.timerEndsAt ? "Time until retry" : "Elapsed time"

  const brandMark = (size: number, label: string) =>
    props.attention ? (
      <Image systemName="hand.raised.fill" size={size} color={accent} modifiers={[accessibilityLabel(label)]} />
    ) : (
      <Image assetName="BrandMark" size={size} modifiers={[accessibilityLabel(label)]} />
    )

  const timer = (
    <Text
      date={timerDate}
      dateStyle="timer"
      modifiers={[
        font({ size: 13, weight: "semibold", design: "rounded" }),
        monospacedDigit(),
        foregroundStyle(secondary),
        accessibilityLabel(timerLabel),
      ]}
    />
  )

  const context = (
    <HStack spacing={5}>
      <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#F2F2F7"), lineLimit(1)]}>
        {props.repository}
      </Text>
      <Text
        modifiers={[
          font({ size: 13, weight: "medium" }),
          foregroundStyle(tertiary),
          lineLimit(1),
          minimumScaleFactor(0.72),
        ]}
      >
        {props.branch}
      </Text>
      <Spacer />
    </HStack>
  )

  const approvalActions = props.approveURL ? (
    <HStack spacing={8} modifiers={[frame({ maxWidth: 420, alignment: "leading" })]}>
      <Link destination={props.approveURL}>
        <HStack
          spacing={5}
          modifiers={[
            padding({ horizontal: 12, vertical: 7 }),
            background("#F2F2F7"),
            cornerRadius(10),
            accessibilityLabel("Approve once"),
          ]}
        >
          <Image systemName="checkmark" size={11} color="#111113" modifiers={[accessibilityHidden()]} />
          <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle("#111113")]}>Approve once</Text>
        </HStack>
      </Link>
      <Link destination={props.reviewURL}>
        <HStack
          spacing={5}
          modifiers={[
            padding({ horizontal: 12, vertical: 7 }),
            background("#222225"),
            cornerRadius(10),
            accessibilityLabel("Review request in nikcli"),
          ]}
        >
          <Image systemName="arrow.up.forward.app" size={11} color="#F2F2F7" modifiers={[accessibilityHidden()]} />
          <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle("#F2F2F7")]}>Review</Text>
        </HStack>
      </Link>
      <Spacer />
    </HStack>
  ) : null

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={10}
        modifiers={[
          padding({ horizontal: 16, vertical: 14 }),
          activityBackgroundTint("#050506"),
          accessibilityElement("contain"),
        ]}
      >
        <HStack alignment="firstTextBaseline" spacing={8}>
          <Text
            modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(props.attention ? accent : secondary)]}
          >
            {props.status}
          </Text>
          <Spacer />
          {timer}
        </HStack>

        <Text
          modifiers={[
            font({ size: 22, weight: "semibold", design: "rounded" }),
            foregroundStyle("#FFFFFF"),
            lineLimit(2),
            minimumScaleFactor(0.78),
          ]}
        >
          {props.action}
        </Text>

        <Divider modifiers={[foregroundStyle("#2C2C2E")]} />
        {context}
        {approvalActions}
      </VStack>
    ),
    bannerSmall: (
      <HStack
        spacing={8}
        modifiers={[
          padding({ horizontal: 12, vertical: 10 }),
          activityBackgroundTint("#050506"),
          accessibilityElement("combine"),
        ]}
      >
        {brandMark(16, props.status)}
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 13, weight: "semibold" }), lineLimit(1)]}>{props.action}</Text>
          <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary), lineLimit(1)]}>
            {props.repository} {props.branch}
          </Text>
        </VStack>
        <Spacer />
        {timer}
      </HStack>
    ),
    compactLeading: brandMark(14, props.status),
    compactTrailing: timer,
    minimal: brandMark(14, props.status),
    expandedLeading: (
      <HStack spacing={6} modifiers={[padding({ leading: 4 })]}>
        {brandMark(13, props.status)}
        <Text
          modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(props.attention ? accent : secondary)]}
        >
          {props.status}
        </Text>
      </HStack>
    ),
    expandedTrailing: <HStack modifiers={[padding({ trailing: 4 })]}>{timer}</HStack>,
    expandedCenter: (
      <Text
        modifiers={[
          font({ size: 17, weight: "semibold", design: "rounded" }),
          foregroundStyle("#FFFFFF"),
          lineLimit(1),
        ]}
      >
        {props.action}
      </Text>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={9} modifiers={[padding({ top: 6, horizontal: 4 })]}>
        {context}
        {approvalActions ??
          (props.stopURL ? (
            <HStack spacing={8}>
              <Link
                label="Open session"
                destination={props.reviewURL}
                modifiers={[
                  font({ size: 12, weight: "semibold" }),
                  foregroundStyle("#F2F2F7"),
                  padding({ horizontal: 12, vertical: 7 }),
                  background("#222225"),
                  cornerRadius(10),
                ]}
              />
              <Link
                label="Stop"
                destination={props.stopURL}
                modifiers={[
                  font({ size: 12, weight: "semibold" }),
                  foregroundStyle("#FF6961"),
                  padding({ horizontal: 12, vertical: 7 }),
                  background("#291819"),
                  cornerRadius(10),
                  accessibilityLabel("Stop session"),
                ]}
              />
              <Spacer />
            </HStack>
          ) : null)}
      </VStack>
    ),
  }
}

// expo-widgets resolves the ExpoWidgets native module at import time, which
// does not exist in Expo Go — load it lazily so environments without the
// module lose live activities instead of crashing every route that imports
// lib/notifications.ts.
let sessionActivityFactory: {
  start(props: SessionLiveActivityProps, url: string): SessionLiveActivityHandle
  getInstances(): SessionLiveActivityHandle[]
} | null = null
try {
  const { createLiveActivity } = require("expo-widgets") as typeof import("expo-widgets")
  sessionActivityFactory = createLiveActivity("NikcliSessionActivity", SessionActivity)
} catch {
  sessionActivityFactory = null
}

export function startSessionLiveActivity(
  props: SessionLiveActivityProps,
  url: string,
): SessionLiveActivityHandle | null {
  return sessionActivityFactory ? sessionActivityFactory.start(props, url) : null
}

export function getSessionLiveActivityInstances(): SessionLiveActivityHandle[] {
  return sessionActivityFactory ? sessionActivityFactory.getInstances() : []
}
