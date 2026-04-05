import { useEffect, useState } from "react"
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native"
import { router } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer, userLogin, userRegister, userStatus } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"

export default function LoginScreen() {
  const { palette, isDark } = useAppTheme()
  const { top, bottom } = useSafeAreaInsets()
  const { config, setUserSession } = useServer()

  const [tab, setTab] = useState<"login" | "register">("login")
  const [hasUsers, setHasUsers] = useState<boolean | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(true)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [config])

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
      await setUserSession(result.token, result.user)
      router.replace("/sessions")
    } catch (err: any) {
      setError(err.message || "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  if (checkingStatus) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    )
  }

  const isLogin = tab === "login"

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: top + 24, paddingBottom: bottom + 24, paddingHorizontal: 20 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ alignItems: "center", marginBottom: 32 }}>
          <View
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
            }}
          >
            <Text style={{ color: isDark ? "#0a0a0a" : "#fff", fontWeight: "800", fontSize: 24 }}>N</Text>
          </View>
          <Text style={{ color: palette.ink, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 }}>nikcli</Text>
          <Text style={{ color: palette.muted, fontSize: 14, marginTop: 4 }}>
            {hasUsers === false ? "Create your account to get started" : "Sign in to your account"}
          </Text>
        </View>

        {/* Tab switcher */}
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
                  onPress={() => setTab(t)}
                  style={{ minHeight: 40, borderRadius: 10 }}
                />
              </View>
            ))}
          </View>
        )}

        <SurfaceCard style={{ gap: 16, padding: 20 }}>
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

          {error ? <ErrorBanner message={error} /> : null}

          <ActionButton
            label={loading ? "" : isLogin ? "Sign in" : "Create account"}
            loading={loading}
            onPress={handleSubmit}
            disabled={loading || !email || !password || (!isLogin && !username)}
            style={{ marginTop: 4 }}
          />
        </SurfaceCard>

        {config && (
          <Text style={{ color: palette.muted, fontSize: 11, textAlign: "center", marginTop: 16 }}>
            Connecting to {config.url}
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
