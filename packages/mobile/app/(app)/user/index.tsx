import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useFocusEffect } from "expo-router"
import {
  Award,
  ChevronDown,
  ChevronUp,
  Crown,
  Edit3,
  Flame,
  Globe,
  LogOut,
  Shield,
  Sparkles,
  Star,
  Target,
  Trash2,
  TrendingUp,
  UserCircle2,
  Users,
  Zap,
} from "lucide-react-native"
import { useServer, userDelete, userList, userUpdate, type UserProfile } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import { ActionButton } from "@/components/ui/ActionButton"
import { TextField } from "@/components/ui/TextField"
import { InfoChip } from "@/components/ui/InfoChip"
import { EmptyState } from "@/components/ui/EmptyState"
import { AdaptiveBlur } from "@/components/GlassView"

// ─── Animation helpers ────────────────────────────────────────────────────────

const SPRING_CONFIG = { damping: 18, stiffness: 280, mass: 1 }
const STAGGER_DELAY = 80

function useEntranceAnimation(count: number, startDelay = 0) {
  const animations = useRef(count > 0 ? Array.from({ length: count }, () => new Animated.Value(0)) : []).current
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const batch = animations.map((anim, i) =>
      Animated.spring(anim, {
        toValue: 1,
        delay: startDelay + i * STAGGER_DELAY,
        ...SPRING_CONFIG,
        useNativeDriver: true,
      }),
    )
    Animated.parallel(batch).start(() => setIsReady(true))
    return () => {
      batch.forEach((a) => a.stop())
      setIsReady(false)
    }
  }, [])

  return { animations, isReady }
}

// ─── Animated Avatar ─────────────────────────────────────────────────────────

function AnimatedAvatar({ user, size = 80 }: { user: UserProfile; size?: number }) {
  const { palette, isDark } = useAppTheme()
  const pulseAnim = useRef(new Animated.Value(1)).current
  const glowAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.4,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    )
    pulse.start()
    glow.start()
    return () => {
      pulse.stop()
      glow.stop()
    }
  }, [])

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.95, ...SPRING_CONFIG, useNativeDriver: true }).start()
  }
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, ...SPRING_CONFIG, useNativeDriver: true }).start()
  }

  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] })

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: isDark ? palette.accent : palette.accentLight,
          opacity: glowOpacity,
          transform: [{ scale: 1.15 }],
        }}
      />
      <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(14,165,233,0.35)",
            backgroundColor: isDark ? "rgba(14,165,233,0.18)" : "rgba(14,165,233,0.12)",
            overflow: "hidden",
          }}
        >
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={40}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? "rgba(14,165,233,0.18)" : "rgba(14,165,233,0.12)"}
          />
          <Text
            style={{
              fontSize: size * 0.32,
              fontWeight: "800",
              color: palette.accentLight,
              letterSpacing: 0.5,
              zIndex: 1,
            }}
          >
            {initials(user)}
          </Text>
        </View>
      </Pressable>
  )
}

// ─── Legacy Avatar (for list items) ──────────────────────────────────────────

function Avatar({ user, size = 38 }: { user: UserProfile; size?: number }) {
  const { palette, isDark } = useAppTheme()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1.5,
        borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(14,165,233,0.30)",
        backgroundColor: isDark ? "rgba(14,165,233,0.14)" : "rgba(14,165,233,0.10)",
      }}
    >
      <AdaptiveBlur
        tint={isDark ? "dark" : "light"}
        intensity={30}
        style={StyleSheet.absoluteFill}
        fallbackColor={isDark ? "rgba(14,165,233,0.14)" : "rgba(14,165,233,0.10)"}
      />
      <Text
        style={{
          fontSize: size * 0.34,
          fontWeight: "800",
          color: palette.accentLight,
          letterSpacing: 0.5,
          zIndex: 1,
        }}
      >
        {initials(user)}
      </Text>
    </View>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function initials(user: UserProfile) {
  const name = user.display_name || user.username
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

// ─── Animated Stat Card ──────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  trend?: string
  color: string
  animation: Animated.Value
  index: number
}

function StatCard({ icon, label, value, trend, color, animation, index }: StatCardProps) {
  const { palette, isDark } = useAppTheme()
  const scaleAnim = useRef(new Animated.Value(1)).current

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.97, ...SPRING_CONFIG, useNativeDriver: true }).start()
  }
  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, ...SPRING_CONFIG, useNativeDriver: true }).start()
  }

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: animation,
        transform: [
          { translateY: animation.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
          { scale: scaleAnim },
        ],
      }}
    >
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={{
          backgroundColor: isDark ? "rgba(24,24,24,0.85)" : "rgba(255,255,255,0.88)",
          borderRadius: 20,
          padding: 14,
          borderWidth: 1,
          borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.80)",
          shadowColor: isDark ? "#000" : palette.shadow,
          shadowOpacity: isDark ? 0.25 : 0.08,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              backgroundColor: isDark ? `${color}20` : `${color}15`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </View>
          {trend && (
            <View
              style={{
                backgroundColor: isDark ? "rgba(22,163,74,0.15)" : "rgba(22,163,74,0.10)",
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 6,
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: "700", color: palette.success }}>{trend}</Text>
            </View>
          )}
        </View>
        <Text
          style={{
            fontSize: 22,
            fontWeight: "800",
            color: palette.ink,
            marginTop: 10,
            letterSpacing: -0.5,
          }}
        >
          {value}
        </Text>
        <Text style={{ fontSize: 11, color: palette.soft, marginTop: 2, fontWeight: "500" }}>{label}</Text>
      </Pressable>
    </Animated.View>
  )
}

// ─── Animated Progress Bar ───────────────────────────────────────────────────

interface ProgressBarProps {
  label: string
  value: number
  max?: number
  color: string
  animation: Animated.Value
  delay?: number
}

function AnimatedProgressBar({ label, value, max = 100, color, animation, delay = 0 }: ProgressBarProps) {
  const { palette, isDark } = useAppTheme()
  const progressAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.timing(progressAnim, {
        toValue: value / max,
        duration: 1000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start()
    }, delay)
    return () => clearTimeout(timeout)
  }, [value, max, delay])

  const width = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  })

  return (
    <Animated.View
      style={{
        opacity: animation,
        transform: [{ translateX: animation.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
        marginBottom: 14,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink }}>{label}</Text>
        <Text style={{ fontSize: 12, fontWeight: "700", color: palette.soft, fontVariant: ["tabular-nums"] }}>
          {Math.round((value / max) * 100)}%
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.60)",
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={{
            height: "100%",
            width,
            backgroundColor: color,
            borderRadius: 3,
          }}
        />
      </View>
    </Animated.View>
  )
}

// ─── Achievement Badge ───────────────────────────────────────────────────────

interface AchievementBadgeProps {
  icon: React.ReactNode
  label: string
  earned: boolean
  animation: Animated.Value
  index: number
}

function AchievementBadge({ icon, label, earned, animation, index }: AchievementBadgeProps) {
  const { palette, isDark } = useAppTheme()
  const scaleAnim = useRef(new Animated.Value(earned ? 1 : 0.8)).current
  const rotateAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (earned) {
      Animated.sequence([
        Animated.timing(rotateAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, ...SPRING_CONFIG, useNativeDriver: true }),
      ]).start()
    }
  }, [earned])

  const handlePressIn = () => {
    if (earned) {
      Animated.spring(scaleAnim, { toValue: 0.9, ...SPRING_CONFIG, useNativeDriver: true }).start()
    }
  }
  const handlePressOut = () => {
    if (earned) {
      Animated.spring(scaleAnim, { toValue: 1, ...SPRING_CONFIG, useNativeDriver: true }).start()
    }
  }

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["0deg", "-15deg", "0deg"],
  })

  return (
    <Animated.View
      style={{
        opacity: animation,
      }}
    >
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={{
          alignItems: "center",
          gap: 6,
          padding: 12,
          borderRadius: 16,
          backgroundColor: earned
            ? isDark
              ? "rgba(255,215,0,0.12)"
              : "rgba(255,215,0,0.15)"
            : isDark
              ? "rgba(255,255,255,0.04)"
              : "rgba(193,208,223,0.30)",
          borderWidth: 1,
          borderColor: earned ? (isDark ? "rgba(255,215,0,0.30)" : "rgba(255,215,0,0.40)") : "transparent",
          minWidth: 80,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 12,
            backgroundColor: earned
              ? isDark
                ? "rgba(255,215,0,0.20)"
                : "rgba(255,215,0,0.25)"
              : isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(193,208,223,0.40)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </View>
        <Text
          style={{
            fontSize: 10,
            fontWeight: "600",
            color: earned ? (isDark ? "#FFD700" : "#B8860B") : palette.muted,
            textAlign: "center",
          }}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

// ─── Premium Section with Shimmer ─────────────────────────────────────────────

function PremiumSection({ children, animation }: { children: React.ReactNode; animation: Animated.Value }) {
  const { palette, isDark } = useAppTheme()
  const shimmerAnim = useRef(new Animated.Value(0)).current
  const shimmerOpacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerOpacity, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerOpacity, {
          toValue: 0.3,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    shimmer.start()
    return () => shimmer.stop()
  }, [])

  return (
    <Animated.View
      style={{
        opacity: animation,
        transform: [{ scale: animation.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }],
      }}
    >
      <View
        style={{
          borderRadius: 28,
          borderWidth: 1.5,
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(14,165,233,0.25)",
          backgroundColor: isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.92)",
          overflow: "hidden",
          shadowColor: isDark ? "#000" : palette.shadow,
          shadowOpacity: isDark ? 0.3 : 0.1,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 12 },
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 80,
            opacity: shimmerOpacity,
            backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(14,165,233,0.10)",
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 18,
            right: 18,
            height: 1,
            backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.80)",
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: -15,
            top: -15,
            width: 70,
            height: 70,
            borderRadius: 999,
            backgroundColor: isDark ? "rgba(255,255,255,0.025)" : "rgba(14,165,233,0.08)",
          }}
        />
        {children}
      </View>
    </Animated.View>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ label, animation }: { label: string; animation: Animated.Value }) {
  return (
    <Animated.View
      style={{
        opacity: animation,
        transform: [{ translateY: animation.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      <Text className="mb-2 ml-1 text-[10px] font-bold uppercase tracking-[1.6px] text-muted">{label}</Text>
    </Animated.View>
  )
}

// ─── Glass card wrapper ──────────────────────────────────────────────────────

function GlassCard({ children, animation }: { children: React.ReactNode; animation: Animated.Value }) {
  const { palette, isDark } = useAppTheme()
  return (
    <Animated.View
      style={{
        opacity: animation,
        transform: [{ translateY: animation.interpolate({ inputRange: [0, 1], outputRange: [15, 0] }) }],
      }}
    >
      <View
        style={{
          borderRadius: 28,
          borderWidth: 1,
          borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.90)",
          backgroundColor: isDark ? "rgba(17,17,17,0.72)" : palette.surface,
          overflow: "hidden",
          marginBottom: 16,
          shadowColor: isDark ? "#000" : palette.shadow,
          shadowOpacity: isDark ? 0.28 : 0.09,
          shadowRadius: isDark ? 18 : 20,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 18,
            right: 18,
            height: 1,
            backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.72)",
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: -20,
            top: -22,
            width: 80,
            height: 80,
            borderRadius: 999,
            backgroundColor: isDark ? "rgba(255,255,255,0.025)" : "rgba(14,165,233,0.07)",
          }}
        />
        {children}
      </View>
    </Animated.View>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider() {
  const { isDark } = useAppTheme()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
      }}
    />
  )
}

// ─── UserRow (admin list) ────────────────────────────────────────────────────

function UserRow({
  user,
  currentUser,
  serverUrl,
  token,
  onRefresh,
  animation,
}: {
  user: UserProfile
  currentUser: UserProfile
  serverUrl: string
  token: string
  onRefresh: () => void
  animation: Animated.Value
}) {
  const { palette } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const isSelf = user.id === currentUser.id
  const pressAnim = useRef(new Animated.Value(1)).current

  function confirmDelete() {
    Alert.alert("Delete user", `Remove @${user.username}? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true)
          await userDelete(serverUrl, token, user.id).catch(() => null)
          setBusy(false)
          onRefresh()
        },
      },
    ])
  }

  async function toggleRole() {
    setBusy(true)
    await userUpdate(serverUrl, token, user.id, {
      role: user.role === "admin" ? "user" : "admin",
    }).catch(() => null)
    setBusy(false)
    onRefresh()
  }

  return (
    <Animated.View
      style={{
        opacity: animation,
        transform: [{ translateX: animation.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
      }}
    >
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        onPressIn={() => Animated.spring(pressAnim, { toValue: 0.97, ...SPRING_CONFIG, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(pressAnim, { toValue: 1, ...SPRING_CONFIG, useNativeDriver: true }).start()}
        style={{ opacity: pressAnim }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 18,
            paddingVertical: 12,
          }}
        >
          <Avatar user={user} size={38} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink, letterSpacing: -0.1 }}>
              {user.display_name || user.username}
              {isSelf ? <Text style={{ fontSize: 11, fontWeight: "500", color: palette.muted }}> · you</Text> : null}
            </Text>
            <Text style={{ fontSize: 11, color: palette.soft }}>{user.email}</Text>
          </View>
          <InfoChip
            label={user.role === "admin" ? "Admin" : "User"}
            tone={user.role === "admin" ? "warn" : "neutral"}
          />
          {!isSelf &&
            (expanded ? (
              <ChevronUp size={14} color={palette.muted} />
            ) : (
              <ChevronDown size={14} color={palette.muted} />
            ))}
        </View>
      </Pressable>

      {expanded && !isSelf && (
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 18, paddingBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <ActionButton
              label={user.role === "admin" ? "Revoke admin" : "Make admin"}
              variant="secondary"
              loading={busy}
              onPress={toggleRole}
            />
          </View>
          <View style={{ flex: 1 }}>
            <ActionButton label="Delete" variant="danger" loading={busy} onPress={confirmDelete} />
          </View>
        </View>
      )}
    </Animated.View>
  )
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function UserScreen() {
  const { config, currentUser, userToken, signOut } = useServer()
  const { palette, isDark } = useAppTheme()

  const [displayName, setDisplayName] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const [users, setUsers] = useState<UserProfile[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Entrance animations
  const { animations: entranceAnimations } = useEntranceAnimation(8)
  const headerAnim = entranceAnimations[0] || new Animated.Value(0)
  const statsAnim = entranceAnimations[1] || new Animated.Value(0)
  const profileAnim = entranceAnimations[2] || new Animated.Value(0)
  const editAnim = entranceAnimations[3] || new Animated.Value(0)
  const achievementsAnim = entranceAnimations[4] || new Animated.Value(0)
  const adminAnim = entranceAnimations[5] || new Animated.Value(0)
  const sessionAnim = entranceAnimations[6] || new Animated.Value(0)
  const saveAnim = entranceAnimations[7] || new Animated.Value(0)

  useEffect(() => {
    if (currentUser) setDisplayName(currentUser.display_name ?? "")
  }, [currentUser])

  const loadUsers = useCallback(async () => {
    if (!config || !userToken || currentUser?.role !== "admin") return
    setUsersLoading(true)
    const list = await userList(config.url, userToken).catch(() => [] as UserProfile[])
    setUsers(list)
    setUsersLoading(false)
  }, [config, currentUser?.role, userToken])

  useFocusEffect(
    useCallback(() => {
      loadUsers()
    }, [loadUsers]),
  )

  async function handleRefresh() {
    setRefreshing(true)
    await loadUsers()
    setRefreshing(false)
  }

  async function handleSave() {
    if (!config || !userToken || !currentUser) return
    if (newPassword && newPassword !== confirmPassword) {
      setSaveMsg({ text: "Passwords do not match.", ok: false })
      return
    }
    setSaving(true)
    setSaveMsg(null)
    const body: { displayName?: string; password?: string } = {}
    if (displayName.trim() !== (currentUser.display_name ?? "")) body.displayName = displayName.trim()
    if (newPassword) body.password = newPassword
    if (!Object.keys(body).length) {
      setSaving(false)
      setSaveMsg({ text: "No changes.", ok: false })
      return
    }
    const result = await userUpdate(config.url, userToken, currentUser.id, body).catch((e: Error) => e)
    setSaving(false)
    if (result instanceof Error) {
      setSaveMsg({ text: result.message, ok: false })
    } else {
      setNewPassword("")
      setConfirmPassword("")
      setSaveMsg({ text: "Changes saved.", ok: true })
    }
  }

  function handleSignOut() {
    Alert.alert("Sign out", "Disconnect from this server?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => signOut() },
    ])
  }

  if (!currentUser) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: palette.background,
        }}
      >
        <EmptyState title="Not signed in" description="Connect to a server and sign in to view your profile." />
      </View>
    )
  }

  const memberSince = new Date(currentUser.created_at).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })

  // Calculate user stats (mock data for demo)
  const sessionDays = Math.floor((Date.now() - new Date(currentUser.created_at).getTime()) / (1000 * 60 * 60 * 24))
  const completionRate = Math.min(95, Math.floor(Math.random() * 30) + 65)

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={palette.accent} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity hero ── */}
        <Animated.View
          style={{
            opacity: headerAnim,
            transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [25, 0] }) }],
          }}
        >
          <View
            style={{
              borderRadius: 28,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.90)",
              backgroundColor: isDark ? "rgba(17,17,17,0.72)" : palette.surface,
              overflow: "hidden",
              marginBottom: 16,
              shadowColor: isDark ? "#000" : (palette.shadow ?? "#000"),
              shadowOpacity: isDark ? 0.28 : 0.09,
              shadowRadius: isDark ? 18 : 20,
              shadowOffset: { width: 0, height: 10 },
            }}
          >
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 18,
                right: 18,
                height: 1,
                backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.72)",
              }}
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                right: -20,
                top: -22,
                width: 100,
                height: 100,
                borderRadius: 999,
                backgroundColor: isDark ? "rgba(255,255,255,0.025)" : "rgba(14,165,233,0.07)",
              }}
            />
            <View style={{ padding: 20, flexDirection: "row", alignItems: "center", gap: 18 }}>
              <AnimatedAvatar user={currentUser} size={80} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text
                  style={{ fontSize: 22, fontWeight: "800", color: palette.ink, letterSpacing: -0.4 }}
                  numberOfLines={1}
                >
                  {currentUser.display_name || currentUser.username}
                </Text>
                <Text style={{ fontSize: 13, color: palette.soft }}>@{currentUser.username}</Text>
                <Text style={{ fontSize: 12, color: palette.soft }}>{currentUser.email}</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <InfoChip
                    label={currentUser.role === "admin" ? "Admin" : "User"}
                    tone={currentUser.role === "admin" ? "warn" : "accent"}
                  />
                  <InfoChip label={`Since ${memberSince}`} tone="neutral" />
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── Stats cards ── */}
        <Animated.View
          style={{
            flexDirection: "row",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <StatCard
            icon={<Globe size={16} color="#0ea5e9" strokeWidth={2.5} />}
            label="Sessions"
            value={String(Math.min(sessionDays + 12, 999))}
            trend="+2"
            color="#0ea5e9"
            animation={statsAnim}
            index={0}
          />
          <StatCard
            icon={<Target size={16} color="#16a34a" strokeWidth={2.5} />}
            label="Completion"
            value={`${completionRate}%`}
            color="#16a34a"
            animation={statsAnim}
            index={1}
          />
          <StatCard
            icon={<Zap size={16} color="#d97706" strokeWidth={2.5} />}
            label="Streak"
            value={`${Math.min(sessionDays, 30)}d`}
            trend={sessionDays > 7 ? "+3" : undefined}
            color="#d97706"
            animation={statsAnim}
            index={2}
          />
        </Animated.View>

        {/* ── Edit profile ── */}
        <SectionLabel label="Edit profile" animation={editAnim} />
        <GlassCard animation={editAnim}>
          <View style={{ padding: 18, gap: 14 }}>
            <TextField label="Username" value={currentUser.username} editable={false} autoCapitalize="none" />
            <TextField
              label="Email"
              value={currentUser.email}
              editable={false}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextField
              label="Display name"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              autoCapitalize="words"
              returnKeyType="done"
            />
            <TextField
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Leave blank to keep current"
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="next"
            />
            {newPassword.length > 0 && (
              <TextField
                label="Confirm password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Repeat new password"
                secureTextEntry
                autoCapitalize="none"
                returnKeyType="done"
              />
            )}
            {saveMsg && (
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "500",
                  color: saveMsg.ok ? palette.success : palette.danger,
                  letterSpacing: 0.1,
                }}
              >
                {saveMsg.text}
              </Text>
            )}
            <ActionButton label="Save changes" loading={saving} onPress={handleSave} />
          </View>
        </GlassCard>

        {/* ── Achievements ── */}
        <SectionLabel label="Achievements" animation={achievementsAnim} />
        <PremiumSection animation={achievementsAnim}>
          <View style={{ padding: 16 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
              <AchievementBadge
                icon={<Shield size={18} color="#FFD700" strokeWidth={2.5} />}
                label="Verified"
                earned={true}
                animation={new Animated.Value(1)}
                index={0}
              />
              <AchievementBadge
                icon={<Star size={18} color="#FFD700" strokeWidth={2.5} />}
                label="Pro Member"
                earned={currentUser.role === "admin"}
                animation={new Animated.Value(1)}
                index={1}
              />
              <AchievementBadge
                icon={<Flame size={18} color="#FF6B35" strokeWidth={2.5} />}
                label="7-Day Streak"
                earned={sessionDays >= 7}
                animation={new Animated.Value(1)}
                index={2}
              />
              <AchievementBadge
                icon={<Award size={18} color="#9333EA" strokeWidth={2.5} />}
                label="Top 10%"
                earned={false}
                animation={new Animated.Value(1)}
                index={3}
              />
            </View>

            {/* Progress section */}
            <View style={{ marginTop: 20 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: palette.ink, marginBottom: 12 }}>
                Profile Strength
              </Text>
              <AnimatedProgressBar
                label="Profile completion"
                value={displayName ? 80 : 40}
                color="#0ea5e9"
                animation={new Animated.Value(1)}
                delay={300}
              />
              <AnimatedProgressBar
                label="Security score"
                value={85}
                color="#16a34a"
                animation={new Animated.Value(1)}
                delay={500}
              />
              <AnimatedProgressBar
                label="Activity level"
                value={Math.min(sessionDays * 5, 100)}
                color="#d97706"
                animation={new Animated.Value(1)}
                delay={700}
              />
            </View>
          </View>
        </PremiumSection>

        {/* ── Admin: user management ── */}
        {currentUser.role === "admin" && (
          <>
            <SectionLabel label="User management" animation={adminAnim} />
            <GlassCard animation={adminAnim}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 18,
                  paddingVertical: 12,
                }}
              >
                <Users size={14} color={palette.accentLight} strokeWidth={2.2} />
                <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: palette.ink }}>
                  {users.length} {users.length === 1 ? "user" : "users"}
                </Text>
                {usersLoading && <ActivityIndicator size="small" color={palette.muted} />}
              </View>
              <Divider />
              {users.length === 0 && !usersLoading ? (
                <View style={{ padding: 18 }}>
                  <Text style={{ fontSize: 13, color: palette.soft, textAlign: "center" }}>No users found.</Text>
                </View>
              ) : (
                users.map((u, i) => (
                  <View key={u.id}>
                    <UserRow
                      user={u}
                      currentUser={currentUser}
                      serverUrl={config!.url}
                      token={userToken!}
                      onRefresh={loadUsers}
                      animation={new Animated.Value(1)}
                    />
                    {i < users.length - 1 && <Divider />}
                  </View>
                ))
              )}
            </GlassCard>
          </>
        )}

        {/* ── Sign out ── */}
        <SectionLabel label="Session" animation={sessionAnim} />
        <GlassCard animation={sessionAnim}>
          <Pressable onPress={handleSignOut} style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 18,
                paddingVertical: 16,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(239,68,68,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.28)",
                }}
              >
                <LogOut size={15} color="#ef4444" strokeWidth={2.2} />
              </View>
              <Text style={{ fontSize: 15, fontWeight: "600", color: "#ef4444", letterSpacing: -0.1 }}>
                Sign out
              </Text>
            </View>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
