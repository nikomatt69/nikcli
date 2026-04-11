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
  Switch,
  Text,
  View,
} from "react-native"
import { router } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Mail } from "lucide-react-native"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer, userLogin, userRegister, userStatus } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import { getRememberedUser, setRememberedUser, clearRememberedUser, type RememberedUser } from "@/lib/storage"
import { triggerHaptic } from "@/lib/haptics"
import { AdaptiveBlur } from "@/components/GlassView"

function AnimatedLogo({ scale, opacity }: { scale: Animated.Value; opacity: Animated.Value }) {
  const { palette, isDark } = useAppTheme()
  return (
    <Animated.View
      style={{
        width: 56,
        height: 56,
        borderRadius: 16,
        backgroundColor: palette.accent,
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 16,
        shadowColor: palette.accent,
        shadowOpacity: 0.4,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        transform: [{ scale }],
        opacity,
      }}
    >
      <Text style={{ color: isDark ? "#0a0a0a" : "#fff", fontWeight: "800", fontSize: 24 }}>N</Text>
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
  const scale = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, damping: 12, stiffness: 200, mass: 0.8, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.spring(scale, { toValue: 0, damping: 15, stiffness: 300, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start()
    }
  }, [visible, scale, opacity])

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
          backgroundColor: "rgba(34,197,94,0.2)",
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
  const { top, bottom } = useSafeAreaInsets()
  const { config, setUserSession } = useServer()

  const [tab, setTab] = useState<"login" | "register">("login")
  const [hasUsers, setHasUsers] = useState<boolean | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [rememberedUser, setRememberedUserState] = useState<RememberedUser | null>(null)
  const [rememberMe, setRememberMe] = useState(true)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const logoScale = useRef(new Animated.Value(0)).current
  const logoOpacity = useRef(new Animated.Value(0)).current
  const formTranslateY = useRef(new Animated.Value(30)).current
  const formOpacity = useRef(new Animated.Value(0)).current
  const shakeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!checkingStatus) {
      Animated.stagger(80, [
        Animated.parallel([
          Animated.spring(logoScale, { toValue: 1, damping: 18, stiffness: 200, mass: 0.8, useNativeDriver: true }),
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
  }, [checkingStatus, logoScale, logoOpacity, formTranslateY, formOpacity])

  useEffect(() => {
    if (!config) return
    setCheckingStatus(true)
    userStatus(config.url)
      .then(({ hasUsers: hu }) => {
        setHasUsers(hu)
        setTab(hu ? "login" : "register")
      })
      .catch(() => setHasUsers(true))
      .finally(() => setCheckingStatus(false))

    void (async () => {
      const user = await getRememberedUser()
      if (user) {
        setRememberedUserState(user)
        setEmail(user.email)
      }
    })()
  }, [config])

  useEffect(() => {
    if (error) {
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 4, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
      ]).start()
    }
  }, [error, shakeAnim])

  async function handleSubmit() {
    if (!config) return
    setError(null)
    setLoading(true)
    try {
      let result: { token: string; user: any }
      if (tab === "login") {
        result = await userLogin(config.url, email.trim(), password)
      } else {
        result = await userRegister(config.url, {
          username: username.trim(),
          email: email.trim(),
          password,
          displayName: displayName.trim() || undefined,
        })
      }

      if (rememberMe && email.trim()) {
        await setRememberedUser(email.trim())
      } else {
        await clearRememberedUser()
      }

      setSuccess(true)
      void triggerHaptic("success")
      await new Promise((r) => setTimeout(r, 600))
      await setUserSession(result.token, result.user)
      router.replace("/sessions")
    } catch (err: any) {
      setError(err.message || "Something went wrong")
      void triggerHaptic("error")
    } finally {
      setLoading(false)
    }
  }

  function handleRememberMeChange(value: boolean) {
    setRememberMe(value)
    void triggerHaptic("selection")
    if (!value) {
      void clearRememberedUser()
      setRememberedUserState(null)
    }
  }

  if (checkingStatus) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background }}>
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
            <Text style={{ color: isDark ? "#0a0a0a" : "#fff", fontWeight: "800", fontSize: 24 }}>N</Text>
          </View>
          <ActivityIndicator color={palette.accent} size="small" />
        </View>
      </View>
    )
  }

  const isLogin = tab === "login"

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
              <Text style={{ color: palette.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 }}>nikcli</Text>
            </Animated.View>
            <Animated.View style={{ opacity: logoOpacity, marginTop: 4 }}>
              <Text style={{ color: palette.muted, fontSize: 14 }}>
                {hasUsers === false ? "Create your account to get started" : "Sign in to your account"}
              </Text>
            </Animated.View>
          </View>

          <AnimatedFormCard translateY={formTranslateY} opacity={formOpacity}>
            {hasUsers !== false && (
              <View
                style={{
                  flexDirection: "row",
                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                  borderRadius: 14,
                  padding: 4,
                  marginBottom: 20,
                }}
              >
                {(["login", "register"] as const).map((t) => (
                  <View key={t} style={{ flex: 1 }}>
                    <ActionButton
                      label={t === "login" ? "Sign in" : "Create account"}
                      variant={tab === t ? "secondary" : "ghost"}
                      onPress={() => {
                        setTab(t)
                        void triggerHaptic("selection")
                      }}
                      style={{ minHeight: 40, borderRadius: 10 }}
                    />
                  </View>
                ))}
              </View>
            )}

            <SurfaceCard className="p-5">
              <View style={{ gap: 16 }}>
                {!isLogin && (
                  <>
                    <TextField
                      label="Username"
                      value={username}
                      onChangeText={setUsername}
                      placeholder="yourname"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                    />
                    <TextField
                      label="Display name (optional)"
                      value={displayName}
                      onChangeText={setDisplayName}
                      placeholder="Your Name"
                      returnKeyType="next"
                    />
                  </>
                )}

                {isLogin && rememberedUser && (
                  <Pressable
                    onPress={() => {
                      setEmail(rememberedUser.email)
                      void triggerHaptic("selection")
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      padding: 14,
                      borderRadius: 14,
                      backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                      borderWidth: 1,
                      borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)",
                      opacity: pressed ? 0.7 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    })}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: palette.accent,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Mail size={18} color="#fff" strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: palette.ink }}>
                        {rememberedUser.email}
                      </Text>
                      <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>Tap to sign in</Text>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 8,
                        backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: "600", color: palette.muted }}>SAVED</Text>
                    </View>
                  </Pressable>
                )}

                <TextField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                  returnKeyType="next"
                />

                <TextField
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder={isLogin ? "" : "At least 8 characters"}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: 4,
                  }}
                >
                  <View>
                    <Text style={{ fontSize: 14, fontWeight: "500", color: palette.ink }}>Remember me</Text>
                    <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>
                      Save email for faster sign in
                    </Text>
                  </View>
                  <Switch
                    value={rememberMe}
                    onValueChange={handleRememberMeChange}
                    trackColor={{ false: palette.border, true: palette.accent }}
                    thumbColor="#fff"
                  />
                </View>

                <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
                  {error ? <ErrorBanner message={error} /> : null}
                </Animated.View>

                <ActionButton
                  label={loading ? "" : isLogin ? "Sign in" : "Create account"}
                  loading={loading}
                  onPress={handleSubmit}
                  disabled={loading || !email || !password || (!isLogin && !username)}
                  style={{ marginTop: 4 }}
                />
              </View>
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
