import { useEffect, useRef, useState } from "react"
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  MapPin,
  Shield,
  ShieldCheck,
  X,
} from "lucide-react-native"
import { triggerHaptic } from "@/lib/haptics"
import { contrastOn, hexToRgba, useAppTheme } from "@/lib/theme"
import type { ApprovalRequest, PermissionRequest, QuestionInfo, QuestionOption, QuestionRequest } from "@/lib/types"

export type ApprovalBarProps = {
  approvals: ApprovalRequest[]
  onPermissionRespond(id: string, response: "once" | "always" | "reject"): void
  onQuestionAnswer(requestID: string, answers: string[][]): void
  onQuestionReject(requestID: string): void
}

type ApprovalType = "permission" | "question"

function getApprovalType(request: ApprovalRequest): ApprovalType {
  return "questions" in request ? "question" : "permission"
}

function ApprovalItemIcon(props: { type: ApprovalType; permission?: string; isDark: boolean }) {
  const { palette } = useAppTheme()

  if (props.type === "question") {
    return (
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: hexToRgba(palette.accent, 0.28),
          backgroundColor: hexToRgba(palette.accent, 0.12),
          padding: 5,
          flexShrink: 0,
        }}
      >
        <HelpCircle size={13} color={palette.accent} strokeWidth={2.1} />
      </View>
    )
  }

  // Check for special permission types
  const perm = props.permission?.toLowerCase() ?? ""
  if (perm.includes("plan_exit")) {
    return (
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: hexToRgba(palette.success, 0.28),
          backgroundColor: hexToRgba(palette.success, 0.1),
          padding: 5,
          flexShrink: 0,
        }}
      >
        <MapPin size={13} color={palette.success} strokeWidth={2.1} />
      </View>
    )
  }
  if (perm.includes("plan_enter")) {
    return (
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: hexToRgba(palette.accent, 0.28),
          backgroundColor: hexToRgba(palette.accent, 0.1),
          padding: 5,
          flexShrink: 0,
        }}
      >
        <MapPin size={13} color={palette.accent} strokeWidth={2.1} />
      </View>
    )
  }

  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: hexToRgba(palette.warn, 0.22),
        backgroundColor: hexToRgba(palette.warn, 0.1),
        padding: 5,
        flexShrink: 0,
      }}
    >
      <Shield size={13} color={palette.warn} strokeWidth={2.1} />
    </View>
  )
}

function PermissionApprovalView(props: {
  request: PermissionRequest
  isDark: boolean
  onRespond: (response: "once" | "always" | "reject") => void
}) {
  const { isDark } = props
  const { palette } = useAppTheme()
  const permissionName = (props.request.permission || "Action")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
  const metadataCommand = props.request.metadata.command
  const command =
    typeof metadataCommand === "string" && metadataCommand.trim()
      ? metadataCommand.trim()
      : props.request.patterns.find((pattern) => pattern.trim())?.trim()

  return (
    <View style={{ gap: 8 }}>
      <Text
        selectable
        numberOfLines={2}
        style={{
          fontSize: 13,
          lineHeight: 16,
          fontWeight: "500",
          color: palette.soft,
        }}
      >
        {command ? `${permissionName} wants to run ` : `${permissionName} needs your approval`}
        {command ? (
          <Text
            selectable
            style={{
              color: palette.ink,
              fontFamily: "monospace",
              fontSize: 10.5,
              fontWeight: "600",
              backgroundColor: hexToRgba(palette.ink, isDark ? 0.08 : 0.06),
            }}
          >
            {command}
          </Text>
        ) : null}
      </Text>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => props.onRespond("reject")}
          accessibilityRole="button"
          accessibilityLabel={`Deny ${props.request.permission}`}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: hexToRgba(palette.ink, 0.16),
            backgroundColor: hexToRgba(palette.ink, isDark ? 0.06 : 0.04),
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.7 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <Text
            style={{
              color: palette.muted,
              fontSize: 13,
              fontWeight: "700",
            }}
          >
            Deny
          </Text>
        </Pressable>
        <Pressable
          onPress={() => props.onRespond("once")}
          accessibilityRole="button"
          accessibilityLabel={`Allow ${props.request.permission} once`}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 44,
            borderRadius: 999,
            backgroundColor: palette.accent,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.76 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <Text
            style={{
              color: contrastOn(palette.accent),
              fontSize: 13,
              fontWeight: "700",
            }}
          >
            Allow once
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function QuestionApprovalView(props: {
  request: QuestionRequest
  isDark: boolean
  selectedAnswers: number[][]
  onSelectAnswer: (questionIndex: number, optionIndex: number, toggle: boolean) => void
}) {
  const { isDark, selectedAnswers, onSelectAnswer } = props
  const { palette } = useAppTheme()
  const questions = props.request.questions
  const [currentQuestion, setCurrentQuestion] = useState(0)

  const question = questions[currentQuestion]
  const options = question?.options ?? []
  const isMultiple = question?.multiple === true

  // Get selected option index for current question
  const effectiveSelected = selectedAnswers[currentQuestion] ?? []

  if (!question) return null

  const accentColor = palette.accent
  const optionBgSelected = hexToRgba(palette.accent, 0.15)

  return (
    <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 10 }}>
      {/* Question header */}
      <View style={{ marginBottom: 6 }}>
        <Text
          style={{
            fontSize: 9,
            fontWeight: "700",
            letterSpacing: 1.1,
            textTransform: "uppercase",
            color: accentColor,
            marginBottom: 2,
          }}
        >
          {questions.length > 1 ? `Question ${currentQuestion + 1}/${questions.length}` : "Question"}
        </Text>
        <Text
          style={{
            fontSize: 12,
            fontWeight: "500",
            color: palette.ink,
          }}
          numberOfLines={2}
        >
          {question.question}
        </Text>
      </View>

      {/* Options - scrollable if many */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: "column",
          gap: 10,
          paddingVertical: 10,
        }}
      >
        {options.map((option, optIdx) => {
          const isSelected = effectiveSelected.includes(optIdx)

          return (
            <Pressable
              key={option.label ?? `option-${optIdx}`}
              onPress={() => onSelectAnswer(currentQuestion, optIdx, isMultiple)}
              style={({ pressed }) => ({
                borderRadius: 12,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: isSelected
                  ? hexToRgba(palette.accent, 0.45)
                  : hexToRgba(palette.ink, isDark ? 0.14 : 0.12),
                backgroundColor: isSelected
                  ? optionBgSelected
                  : pressed
                    ? hexToRgba(palette.ink, 0.05)
                    : hexToRgba(palette.ink, isDark ? 0.06 : 0.04),
                flexShrink: 0,
                opacity: pressed ? 0.8 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <View
                style={{
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                }}
              >
                {isMultiple && (
                  <View
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      borderWidth: 1.5,
                      borderColor: isSelected ? accentColor : hexToRgba(palette.ink, 0.22),
                      backgroundColor: isSelected ? accentColor : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isSelected && <Check size={10} color={contrastOn(accentColor)} strokeWidth={3} />}
                  </View>
                )}
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: isSelected ? accentColor : palette.ink,
                  }}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Question navigation (only if multiple questions) */}
      {questions.length > 1 && (
        <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
          {questions.map((q, idx) => (
            <Pressable
              key={q.question ?? `q-${idx}`}
              onPress={() => setCurrentQuestion(idx)}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  idx === currentQuestion
                    ? accentColor
                    : (selectedAnswers[idx]?.length ?? 0) > 0
                      ? hexToRgba(palette.accent, 0.5)
                      : hexToRgba(palette.ink, 0.18),
              }}
            />
          ))}
        </View>
      )}
    </View>
  )
}

export function ComposerApprovalBar(props: ApprovalBarProps) {
  const { palette, isDark } = useAppTheme()
  const [index, setIndex] = useState(0)
  const slideAnimRef = useRef<Animated.Value | null>(null)
  if (slideAnimRef.current === null) slideAnimRef.current = new Animated.Value(0)
  const slideAnim = slideAnimRef.current
  const opacityAnimRef = useRef<Animated.Value | null>(null)
  if (opacityAnimRef.current === null) opacityAnimRef.current = new Animated.Value(0)
  const opacityAnim = opacityAnimRef.current
  const [selectedAnswers, setSelectedAnswers] = useState<number[][]>([])

  const count = props.approvals.length
  const current = props.approvals[Math.min(index, count - 1)]
  const currentType = current ? getApprovalType(current) : null

  // Reset selected answers when switching between requests
  useEffect(() => {
    setSelectedAnswers([])
  }, [index])

  // Clear cross-request stale state when the set of approvals changes:
  // switching to a new question request (different id) must never inherit
  // selectedAnswers from the previous request's same slot.
  const approvalsSignature = props.approvals.map((a) => a.id).join("|")
  useEffect(() => {
    setSelectedAnswers([])
    setIndex(0)
    // approvalsSignature changes whenever the id set changes; this fires on
    // every approval transition, exactly what we want.
  }, [approvalsSignature])

  useEffect(() => {
    if (count === 0) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 1,
          useNativeDriver: true,
          damping: 16,
          stiffness: 200,
          mass: 0.9,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
      ]).start()
      setIndex((prev) => (prev >= count ? count - 1 : prev))
    }
  }, [count, slideAnim, opacityAnim])

  if (!current) return null

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 0],
  })

  function handlePermissionRespond(response: "once" | "always" | "reject") {
    void triggerHaptic(response === "reject" ? "error" : "success")
    props.onPermissionRespond(current.id, response)
    setIndex((prev) => Math.max(0, Math.min(prev, count - 2)))
  }

  function handleQuestionSelectAnswer(questionIndex: number, optionIndex: number, toggle: boolean) {
    void triggerHaptic("selection")

    if (currentType !== "question") return
    const question = (current as QuestionRequest).questions[questionIndex]
    const isMultiple = question?.multiple === true

    setSelectedAnswers((prev) => {
      const updated = prev.map((answer) => [...answer])
      const currentSelection = updated[questionIndex] ?? []
      updated[questionIndex] = isMultiple
        ? currentSelection.includes(optionIndex)
          ? currentSelection.filter((value) => value !== optionIndex)
          : [...currentSelection, optionIndex]
        : [optionIndex]
      return updated
    })
  }

  function handleQuestionSubmit() {
    if (currentType !== "question") return

    const questions = (current as QuestionRequest).questions
    const answers = questions.map((question, questionIndex) =>
      (selectedAnswers[questionIndex] ?? [])
        .map((optionIndex) => question.options[optionIndex]?.label)
        .filter((label): label is string => Boolean(label)),
    )
    props.onQuestionAnswer(current.id, answers)
    setIndex((prev) => Math.max(0, Math.min(prev, count - 2)))
  }

  function handleQuestionReject() {
    void triggerHaptic("error")
    props.onQuestionReject(current.id)
    setIndex((prev) => Math.max(0, Math.min(prev, count - 2)))
  }

  const barColors =
    currentType === "question"
      ? {
          border: hexToRgba(palette.accent, 0.22),
          background: hexToRgba(palette.accent, isDark ? 0.12 : 0.08),
          tint: hexToRgba(palette.accent, 0.04),
        }
      : {
          border: hexToRgba(palette.warn, 0.28),
          background: hexToRgba(palette.warn, 0.07),
          tint: hexToRgba(palette.warn, 0.04),
        }

  if (currentType === "permission") {
    return (
      <Animated.View style={{ opacity: opacityAnim, transform: [{ translateY }] }}>
        <View
          style={{
            marginHorizontal: 14,
            borderRadius: 16,
            borderCurve: "continuous",
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: barColors.border,
            backgroundColor: barColors.background,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <PermissionApprovalView
            request={current as PermissionRequest}
            isDark={isDark}
            onRespond={handlePermissionRespond}
          />
        </View>
      </Animated.View>
    )
  }

  return (
    <Animated.View
      style={{
        opacity: opacityAnim,
        transform: [{ translateY }],
      }}
    >
      <View
        style={{
          marginHorizontal: 14,
          marginBottom: 6,
          borderRadius: 16,
          borderCurve: "continuous",
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth,
          padding: 6,
          marginTop: 8,
          borderColor: barColors.border,
          backgroundColor: barColors.background,
        }}
      >
        {/* Inner tint */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: barColors.tint }]} pointerEvents="none" />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 8,
          }}
        >
          {/* Icon */}
          <ApprovalItemIcon type="question" isDark={isDark} />

          <QuestionApprovalView
            request={current as QuestionRequest}
            key={current.id}
            isDark={isDark}
            selectedAnswers={selectedAnswers}
            onSelectAnswer={handleQuestionSelectAnswer}
          />

          {/* Navigation arrows (only when multiple) */}
          {count > 1 && (
            <View style={{ flexDirection: "row", gap: 16 }}>
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  setIndex((prev) => (prev - 1 + count) % count)
                }}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.5 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <ChevronLeft
                  size={16}
                  color={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"}
                  strokeWidth={2.2}
                />
              </Pressable>
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  setIndex((prev) => (prev + 1) % count)
                }}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.5 : 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                })}
              >
                <ChevronRight
                  size={16}
                  color={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"}
                  strokeWidth={2.2}
                />
              </Pressable>
            </View>
          )}

          {/* Divider */}
          <View
            style={{
              width: StyleSheet.hairlineWidth,
              height: 28,
              backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)",
            }}
          />

          <View style={{ flexDirection: "row", gap: 4, flexShrink: 0 }}>
            {/* Dismiss question */}
            <Pressable
              onPress={handleQuestionReject}
              hitSlop={4}
              style={({ pressed }) => ({
                borderRadius: 10,
                borderWidth: 1,
                borderColor: hexToRgba(palette.danger, 0.28),
                backgroundColor: hexToRgba(palette.danger, 0.12),
                padding: 7,
                minHeight: 44,
                minWidth: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <X size={13} color={palette.danger} strokeWidth={2.4} />
            </Pressable>

            {/* Submit answer (only if single-select answered or for explicit submit) */}
            <Pressable
              onPress={handleQuestionSubmit}
              disabled={(current as QuestionRequest).questions.some(
                (_, questionIndex) => (selectedAnswers[questionIndex]?.length ?? 0) === 0,
              )}
              accessibilityRole="button"
              accessibilityLabel="Submit answers"
              hitSlop={4}
              style={({ pressed }) => ({
                borderRadius: 10,
                borderWidth: 1,
                borderColor: hexToRgba(palette.accent, 0.28),
                backgroundColor: hexToRgba(palette.accent, 0.12),
                padding: 7,
                minHeight: 44,
                minWidth: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: (current as QuestionRequest).questions.some(
                  (_, questionIndex) => (selectedAnswers[questionIndex]?.length ?? 0) === 0,
                )
                  ? 0.4
                  : pressed
                    ? 0.7
                    : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <ArrowRight size={13} color={palette.accent} strokeWidth={2.4} />
            </Pressable>
          </View>
        </View>
      </View>
    </Animated.View>
  )
}
