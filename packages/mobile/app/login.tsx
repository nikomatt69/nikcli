import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Image } from "expo-image"
import { useServer, userMe, userStatus } from "@/lib/server-context"
import { loginWithOAuth } from "@/lib/oauth"
import { router } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { KeyRound } from "lucide-react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { usePrefersReducedMotion } from "@/lib/animation"
import { AdaptiveBlur } from "@/components/GlassView"

function AnimatedLogo({ scale, opacity }: { scale: Animated.Value; opacity: Animated.Value }) {
  return (
    <Animated.View
      style={{
        width: 56,
        height: 56,
        borderRadius: 14,
        overflow: "hidden",
        marginBottom: 16,
        transform: [{ scale }],
        opacity,
      }}
    >
      <Image
        source={require("@/assets/app-icon-mark.png")}
        style={{ width: 56, height: 56 }}
        contentFit="cover"
        accessibilityLabel="nikcli"
      />
    </Animated.View>
  )
}

function AnimatedFormCard({
  translateY,
  opacity,
  children,
}: {
  translateY: Animated.Value
  opacity: Animated.Value
  children: React.ReactNode
}) {
  return <Animated.View style={{ transform: [{ translateY }], opacity }}>{children}</Animated.View>
}

function SuccessCheckmark({ visible }: { visible: boolean }) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const scaleRef = useRef<Animated.Value | null>(null)
  if (scaleRef.current === null) scaleRef.current = new Animated.Value(0)
  const scale = scaleRef.current
  const opacityRef = useRef<Animated.Value | null>(null)
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(0)
  const opacity = opacityRef.current

  useEffect(() => {
    if (prefersReducedMotion) {
      scale.setValue(visible ? 1 : 0)
      opacity.setValue(visible ? 1 : 0)
      return
    }

    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          damping: 12,
          stiffness: 200,
          mass: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 0,
          damping: 15,
          stiffness: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [visible, scale, opacity, prefersReducedMotion])

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          alignItems: "center",
          justifyContent: "center",
          opacity,
          transform: [{ scale }],
        },
      ]}
      pointerEvents="none"
    >
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: "rgba(31,138,101,0.2)",
          borderWidth: 3,
          borderColor: "#22c55e",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 40, color: "#22c55e" }}>✓</Text>
      </View>
    </Animated.View>
  )
}

export default function LoginScreen() {
  const { palette, isDark } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const { top, bottom } = useSafeAreaInsets()
  const { config, setOAuthSession } = useServer()

  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [checkingStatus, setCheckingStatus] = useState(true)

  const [oauthLoading, setOauthLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const logoScaleRef = useRef<Animated.Value | null>(null)
  if (logoScaleRef.current === null) logoScaleRef.current = new Animated.Value(0)
  const logoScale = logoScaleRef.current
  const logoOpacityRef = useRef<Animated.Value | null>(null)
  if (logoOpacityRef.current === null) logoOpacityRef.current = new Animated.Value(0)
  const logoOpacity = logoOpacityRef.current
  const formTranslateYRef = useRef<Animated.Value | null>(null)
  if (formTranslateYRef.current === null) formTranslateYRef.current = new Animated.Value(30)
  const formTranslateY = formTranslateYRef.current
  const formOpacityRef = useRef<Animated.Value | null>(null)
  if (formOpacityRef.current === null) formOpacityRef.current = new Animated.Value(0)
  const formOpacity = formOpacityRef.current
  const shakeAnimRef = useRef<Animated.Value | null>(null)
  if (shakeAnimRef.current === null) shakeAnimRef.current = new Animated.Value(0)
  const shakeAnim = shakeAnimRef.current

  useEffect(() => {
    if (!checkingStatus) {
      if (prefersReducedMotion) {
        logoScale.setValue(1)
        logoOpacity.setValue(1)
        formTranslateY.setValue(0)
        formOpacity.setValue(1)
        return
      }

      Animated.stagger(80, [
        Animated.parallel([
          Animated.spring(logoScale, {
            toValue: 1,
            damping: 18,
            stiffness: 200,
            mass: 0.8,
            useNativeDriver: true,
          }),
          Animated.timing(logoOpacity, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(formTranslateY, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(formOpacity, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [checkingStatus, formOpacity, formTranslateY, logoOpacity, logoScale, prefersReducedMotion])

  useEffect(() => {
    if (!config) return
    setCheckingStatus(true)
    userStatus(config.url)
      .then(({ hasUsers }) => {
        // A server without registered users starts on sign up.
        setMode(hasUsers ? "signin" : "signup")
      })
      .catch(() => setMode("signin"))
      .finally(() => setCheckingStatus(false))
  }, [config])

  useEffect(() => {
    if (error) {
      if (prefersReducedMotion) {
        shakeAnim.setValue(0)
        return
      }

      Animated.sequence([
        Animated.timing(shakeAnim, {
          toValue: 10,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: -10,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 8,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: -8,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 4,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 0,
          duration: 60,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [error, prefersReducedMotion, shakeAnim])

  async function handleOAuth() {
    if (!config) return
    setError(null)
    setOauthLoading(true)
    try {
      const tokens = await loginWithOAuth(config.authIssuer)
      const user = await userMe(config.url, tokens.access)
      setSuccess(true)
      void triggerHaptic("success")
      await setOAuthSession(tokens, user)
      router.replace("/sessions")
    } catch (err) {
      setError(err instanceof Error ? err.message : mode === "signup" ? "Sign up failed" : "Sign in failed")
      void triggerHaptic("error")
    } finally {
      setOauthLoading(false)
    }
  }

  function toggleMode() {
    setMode((current) => (current === "signin" ? "signup" : "signin"))
    setError(null)
    void triggerHaptic("selection")
  }

  if (checkingStatus) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.background,
        }}
      >
        <View style={{ alignItems: "center", gap: 16 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: palette.accent,
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.9,
            }}
          >
            <Text
              style={{
                color: isDark ? "#0a0a0a" : "#fff",
                fontWeight: "800",
                fontSize: 24,
              }}
            >
              N
            </Text>
          </View>
          <ActivityIndicator color={palette.accent} size="small" />
        </View>
      </View>
    )
  }

  const isSignup = mode === "signup"

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <View style={{ flex: 1 }}>
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 20 : 15}
          fallbackColor={palette.background}
          style={StyleSheet.absoluteFill}
        />

        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: top + 24,
            paddingBottom: bottom + 24,
            paddingHorizontal: 20,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <AnimatedLogo scale={logoScale} opacity={logoOpacity} />
            <Animated.View style={{ opacity: logoOpacity }}>
              <Text
                style={{
                  color: palette.ink,
                  fontSize: 26,
                  fontWeight: "700",
                  letterSpacing: -0.5,
                }}
              >
                nikcli
              </Text>
            </Animated.View>
            <Animated.View style={{ opacity: logoOpacity, marginTop: 4 }}>
              <Text style={{ color: palette.muted, fontSize: 14 }}>
                {isSignup ? "Create your account to get started" : "Sign in to your account"}
              </Text>
            </Animated.View>
          </View>

          <AnimatedFormCard translateY={formTranslateY} opacity={formOpacity}>
            <SurfaceCard className="p-5">
              <View style={{ gap: 12 }}>
                <Text
                  style={{
                    color: palette.ink,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                >
                  {isSignup ? "Sign up with Nikcli" : "Sign in with Nikcli"}
                </Text>
                <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>
                  {isSignup
                    ? "Create your Nikcli account securely in your browser with GitHub or an email code."
                    : "Continue securely in your browser with GitHub or an email code."}
                </Text>

                <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
                  {error ? <ErrorBanner message={error} /> : null}
                </Animated.View>

                <ActionButton
                  label={oauthLoading ? "" : isSignup ? "Sign up with Nikcli" : "Sign in with Nikcli"}
                  loading={oauthLoading}
                  onPress={handleOAuth}
                  disabled={oauthLoading || !config}
                />

                <Pressable
                  onPress={toggleMode}
                  accessibilityRole="button"
                  accessibilityLabel={isSignup ? "Switch to sign in" : "Switch to sign up"}
                  hitSlop={8}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, alignSelf: "center", paddingVertical: 4 })}
                >
                  <Text style={{ color: palette.muted, fontSize: 12 }}>
                    {isSignup ? (
                      <>
                        Already have an account?{" "}
                        <Text style={{ color: palette.accentLight, fontWeight: "600" }}>Sign in</Text>
                      </>
                    ) : (
                      <>
                        New to nikcli? <Text style={{ color: palette.accentLight, fontWeight: "600" }}>Sign up</Text>
                      </>
                    )}
                  </Text>
                </Pressable>
              </View>
            </SurfaceCard>

            <SurfaceCard className="mt-4 p-5" tone="panel">
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  router.replace("/connect")
                }}
                accessibilityRole="button"
                accessibilityLabel="Connect with a host mobile token"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <KeyRound size={18} color={palette.accentLight} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>Use a host mobile token</Text>
                  <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>
                    Pair with your host using an nkm_ token instead of an account
                  </Text>
                </View>
              </Pressable>
            </SurfaceCard>
          </AnimatedFormCard>

          {config && (
            <Animated.Text
              style={{
                color: palette.muted,
                fontSize: 11,
                textAlign: "center",
                marginTop: 16,
                opacity: formOpacity,
              }}
            >
              Connecting to {config.url}
            </Animated.Text>
          )}
        </ScrollView>

        <SuccessCheckmark visible={success} />
      </View>
    </KeyboardAvoidingView>
  )
}
