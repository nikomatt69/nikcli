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
import { useAppTheme } from "@/lib/theme"
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
  if (props.type === "question") {
    return (
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: props.isDark ? "rgba(96,165,250,0.28)" : "rgba(59,130,246,0.22)",
          backgroundColor: props.isDark ? "rgba(96,165,250,0.12)" : "rgba(59,130,246,0.10)",
          padding: 5,
          flexShrink: 0,
        }}
      >
        <HelpCircle size={13} color={props.isDark ? "#60a5fa" : "#3b82f6"} strokeWidth={2.1} />
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
          borderColor: props.isDark ? "rgba(52,211,153,0.28)" : "rgba(16,185,129,0.22)",
          backgroundColor: props.isDark ? "rgba(52,211,153,0.10)" : "rgba(16,185,129,0.10)",
          padding: 5,
          flexShrink: 0,
        }}
      >
        <MapPin size={13} color={props.isDark ? "#34d399" : "#059669"} strokeWidth={2.1} />
      </View>
    )
  }
  if (perm.includes("plan_enter")) {
    return (
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: props.isDark ? "rgba(167,139,250,0.28)" : "rgba(139,92,246,0.22)",
          backgroundColor: props.isDark ? "rgba(167,139,250,0.10)" : "rgba(139,92,246,0.10)",
          padding: 5,
          flexShrink: 0,
        }}
      >
        <MapPin size={13} color={props.isDark ? "#a78bfa" : "#7c3aed"} strokeWidth={2.1} />
      </View>
    )
  }

  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: 1,
        borderColor: props.isDark ? "rgba(255,180,0,0.22)" : "rgba(217,119,6,0.22)",
        backgroundColor: props.isDark ? "rgba(255,180,0,0.10)" : "rgba(217,119,6,0.10)",
        padding: 5,
        flexShrink: 0,
      }}
    >
      <Shield size={13} color={props.isDark ? "#fbbf24" : "#d97706"} strokeWidth={2.1} />
    </View>
  )
}

function PermissionApprovalView(props: {
  request: PermissionRequest
  isDark: boolean
  onRespond: (response: "once" | "always" | "reject") => void
}) {
  const { isDark } = props

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 12,
          fontWeight: "500",
          color: isDark ? "rgba(255,255,255,0.82)" : "rgba(30,20,0,0.82)",
        }}
      >
        {props.request.permission}
      </Text>
    </View>
  )
}

function QuestionApprovalView(props: {
  request: QuestionRequest
  isDark: boolean
  selectedAnswers: number[]
  onSelectAnswer: (questionIndex: number, optionIndex: number, toggle: boolean) => void
}) {
  const { isDark, selectedAnswers, onSelectAnswer } = props
  const questions = props.request.questions
  const [currentQuestion, setCurrentQuestion] = useState(0)

  const question = questions[currentQuestion]
  const options = question?.options ?? []
  const isMultiple = question?.multiple === true

  // Get selected option index for current question
  const currentSelected = selectedAnswers[currentQuestion] ?? -1

  // Adjust selected index when switching questions
  const effectiveSelected = currentQuestion < selectedAnswers.length ? selectedAnswers[currentQuestion] : -1

  if (!question) return null

  // Determine colors based on permission type (plan_enter vs plan_exit)
  const perm = props.request.sessionID // Using sessionID as a hint, though questions don't have permission field
  const accentColor = isDark ? "#60a5fa" : "#3b82f6"
  const optionBgSelected = isDark ? "rgba(96,165,250,0.15)" : "rgba(59,130,246,0.10)"

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
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
            color: isDark ? "rgba(255,255,255,0.82)" : "rgba(30,20,0,0.82)",
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
        contentContainerStyle={{ flexDirection: "row", gap: 6, paddingVertical: 2 }}
      >
        {options.map((option, optIdx) => {
          const isSelected = isMultiple
            ? false // For multiple, we just highlight on tap
            : optIdx === effectiveSelected

          return (
            <Pressable
              key={optIdx}
              onPress={() => onSelectAnswer(currentQuestion, optIdx, isMultiple)}
              style={({ pressed }) => ({
                borderRadius: 10,
                borderWidth: 1,
                borderColor: isSelected
                  ? isDark
                    ? "rgba(96,165,250,0.50)"
                    : "rgba(59,130,246,0.40)"
                  : isDark
                    ? "rgba(255,255,255,0.14)"
                    : "rgba(193,208,223,0.78)",
                backgroundColor: isSelected
                  ? optionBgSelected
                  : pressed
                    ? isDark
                      ? "rgba(255,255,255,0.05)"
                      : "rgba(0,0,0,0.03)"
                    : isDark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(255,255,255,0.82)",
                paddingHorizontal: 10,
                paddingVertical: 6,
                flexShrink: 0,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                opacity: pressed ? 0.8 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              {isMultiple && (
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    borderWidth: 1.5,
                    borderColor: isSelected ? accentColor : isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)",
                    backgroundColor: isSelected ? accentColor : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isSelected && <Check size={8} color="#fff" strokeWidth={3} />}
                </View>
              )}
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: isSelected ? accentColor : isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)",
                }}
                numberOfLines={1}
              >
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Question navigation (only if multiple questions) */}
      {questions.length > 1 && (
        <View style={{ flexDirection: "row", gap: 4, marginTop: 8 }}>
          {questions.map((q, idx) => (
            <Pressable
              key={idx}
              onPress={() => setCurrentQuestion(idx)}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  idx === currentQuestion
                    ? accentColor
                    : idx < selectedAnswers.length && selectedAnswers[idx] >= 0
                      ? isDark
                        ? "rgba(96,165,250,0.5)"
                        : "rgba(59,130,246,0.5)"
                      : isDark
                        ? "rgba(255,255,255,0.2)"
                        : "rgba(0,0,0,0.15)",
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
  const slideAnim = useRef(new Animated.Value(0)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([])

  const count = props.approvals.length
  const current = props.approvals[Math.min(index, count - 1)]
  const currentType = current ? getApprovalType(current) : null

  // Reset selected answers when switching between requests
  useEffect(() => {
    setSelectedAnswers([])
  }, [index])

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

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] })

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
      const updated = [...prev]
      updated[questionIndex] = optionIndex

      // For single-select, also submit
      if (!isMultiple) {
        const answers = updated.map((optIdx, qIdx) => {
          if (qIdx >= (current as QuestionRequest).questions.length) return []
          const options = (current as QuestionRequest).questions[qIdx].options
          return optIdx >= 0 && optIdx < options.length ? [options[optIdx].label] : []
        })
        props.onQuestionAnswer(current.id, answers)
      }

      return updated
    })
  }

  function handleQuestionSubmit() {
    if (currentType !== "question") return

    const questions = (current as QuestionRequest).questions
    const answers = selectedAnswers.map((optIdx, qIdx) => {
      if (qIdx >= questions.length) return []
      const options = questions[qIdx].options
      return optIdx >= 0 && optIdx < options.length ? [options[optIdx].label] : []
    })
    props.onQuestionAnswer(current.id, answers)
    setIndex((prev) => Math.max(0, Math.min(prev, count - 2)))
  }

  function handleQuestionReject() {
    void triggerHaptic("error")
    props.onQuestionReject(current.id)
    setIndex((prev) => Math.max(0, Math.min(prev, count - 2)))
  }

  // Determine border/accent colors based on type
  const getBarColors = () => {
    if (currentType === "question") {
      return {
        border: isDark ? "rgba(96,165,250,0.18)" : "rgba(59,130,246,0.22)",
        background: isDark ? "rgba(30,40,60,0.92)" : "rgba(239,246,255,0.96)",
        tint: isDark ? "rgba(96,165,250,0.04)" : "rgba(59,130,246,0.04)",
      }
    }
    return {
      border: isDark ? "rgba(255,200,50,0.18)" : "rgba(217,119,6,0.22)",
      background: isDark ? "rgba(40,30,10,0.92)" : "rgba(255,251,235,0.96)",
      tint: isDark ? "rgba(255,180,0,0.04)" : "rgba(217,119,6,0.04)",
    }
  }

  const barColors = getBarColors()
  const label = currentType === "question" ? "Question" : "Approval required"

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
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
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
          <ApprovalItemIcon
            type={currentType!}
            permission={currentType === "permission" ? (current as PermissionRequest).permission : undefined}
            isDark={isDark}
          />

          {/* Content based on type */}
          {currentType === "permission" ? (
            <PermissionApprovalView
              request={current as PermissionRequest}
              isDark={isDark}
              onRespond={handlePermissionRespond}
            />
          ) : (
            <QuestionApprovalView
              request={current as QuestionRequest}
              isDark={isDark}
              selectedAnswers={selectedAnswers}
              onSelectAnswer={handleQuestionSelectAnswer}
            />
          )}

          {/* Navigation arrows (only when multiple) */}
          {count > 1 && (
            <View style={{ flexDirection: "row", gap: 2 }}>
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  setIndex((prev) => (prev - 1 + count) % count)
                }}
                hitSlop={6}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.5 : 1,
                  padding: 4,
                })}
              >
                <ChevronLeft
                  size={14}
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
                  opacity: pressed ? 0.5 : 1,
                  padding: 4,
                })}
              >
                <ChevronRight
                  size={14}
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

          {/* Action buttons based on type */}
          {currentType === "permission" ? (
            <View style={{ flexDirection: "row", gap: 4, flexShrink: 0 }}>
              {/* Reject */}
              <Pressable
                onPress={() => handlePermissionRespond("reject")}
                hitSlop={4}
                style={({ pressed }) => ({
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(248,113,113,0.30)" : "rgba(239,68,68,0.22)",
                  backgroundColor: isDark ? "rgba(80,28,28,0.80)" : "rgba(239,68,68,0.08)",
                  padding: 7,
                  opacity: pressed ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                })}
              >
                <X size={13} color={isDark ? "#f87171" : "#dc2626"} strokeWidth={2.4} />
              </Pressable>

              {/* Allow once */}
              <Pressable
                onPress={() => handlePermissionRespond("once")}
                hitSlop={4}
                style={({ pressed }) => ({
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(193,208,223,0.78)",
                  backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.82)",
                  padding: 7,
                  opacity: pressed ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                })}
              >
                <Check size={13} color={isDark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.55)"} strokeWidth={2.4} />
              </Pressable>

              {/* Always allow */}
              <Pressable
                onPress={() => handlePermissionRespond("always")}
                hitSlop={4}
                style={({ pressed }) => ({
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(52,211,153,0.28)" : "rgba(16,185,129,0.22)",
                  backgroundColor: isDark ? "rgba(6,40,28,0.82)" : "rgba(16,185,129,0.08)",
                  padding: 7,
                  opacity: pressed ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                })}
              >
                <ShieldCheck size={13} color={isDark ? "#34d399" : "#059669"} strokeWidth={2.2} />
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 4, flexShrink: 0 }}>
              {/* Dismiss question */}
              <Pressable
                onPress={handleQuestionReject}
                hitSlop={4}
                style={({ pressed }) => ({
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(248,113,113,0.30)" : "rgba(239,68,68,0.22)",
                  backgroundColor: isDark ? "rgba(80,28,28,0.80)" : "rgba(239,68,68,0.08)",
                  padding: 7,
                  opacity: pressed ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                })}
              >
                <X size={13} color={isDark ? "#f87171" : "#dc2626"} strokeWidth={2.4} />
              </Pressable>

              {/* Submit answer (only if single-select answered or for explicit submit) */}
              <Pressable
                onPress={handleQuestionSubmit}
                hitSlop={4}
                style={({ pressed }) => ({
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(96,165,250,0.30)" : "rgba(59,130,246,0.22)",
                  backgroundColor: isDark ? "rgba(30,50,80,0.80)" : "rgba(59,130,246,0.08)",
                  padding: 7,
                  opacity: pressed ? 0.7 : 1,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                })}
              >
                <ArrowRight size={13} color={isDark ? "#60a5fa" : "#3b82f6"} strokeWidth={2.4} />
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  )
}
