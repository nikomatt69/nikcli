import { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
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
import { ChevronDown, ChevronUp, LogOut, Shield, Trash2, UserCircle2, Users } from "lucide-react-native"
import { useServer, userDelete, userList, userUpdate, type UserProfile } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import { ActionButton } from "@/components/ui/ActionButton"
import { TextField } from "@/components/ui/TextField"
import { InfoChip } from "@/components/ui/InfoChip"
import { EmptyState } from "@/components/ui/EmptyState"
import { AdaptiveBlur } from "@/components/GlassView"

// ─── helpers ────────────────────────────────────────────────────────────────

function initials(user: UserProfile) {
  const name = user.display_name || user.username
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

// ─── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({ user, size = 64 }: { user: UserProfile; size?: number }) {
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

// ─── Section label ───────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <Text
      className="mb-2 ml-1 text-[10px] font-bold uppercase tracking-[1.6px] text-muted"
    >
      {label}
    </Text>
  )
}

// ─── Glass card wrapper ──────────────────────────────────────────────────────

function GlassCard({ children }: { children: React.ReactNode }) {
  const { palette, isDark } = useAppTheme()
  return (
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
      {/* inner top highlight */}
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
      {/* decorative orb */}
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
}: {
  user: UserProfile
  currentUser: UserProfile
  serverUrl: string
  token: string
  onRefresh: () => void
}) {
  const { palette } = useAppTheme()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const isSelf = user.id === currentUser.id

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
    <View>
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 18,
          paddingVertical: 12,
          opacity: pressed ? 0.78 : 1,
        })}
      >
        <Avatar user={user} size={38} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: palette.ink, letterSpacing: -0.1 }}>
            {user.display_name || user.username}
            {isSelf ? (
              <Text style={{ fontSize: 11, fontWeight: "500", color: palette.muted }}> · you</Text>
            ) : null}
          </Text>
          <Text style={{ fontSize: 11, color: palette.soft }}>{user.email}</Text>
        </View>
        <InfoChip
          label={user.role === "admin" ? "Admin" : "User"}
          tone={user.role === "admin" ? "warn" : "neutral"}
        />
        {!isSelf && (
          expanded
            ? <ChevronUp size={14} color={palette.muted} />
            : <ChevronDown size={14} color={palette.muted} />
        )}
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
            <ActionButton
              label="Delete"
              variant="danger"
              loading={busy}
              onPress={confirmDelete}
            />
          </View>
        </View>
      )}
    </View>
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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: palette.background }}>
        <EmptyState
          title="Not signed in"
          description="Connect to a server and sign in to view your profile."
        />
      </View>
    )
  }

  const memberSince = new Date(currentUser.created_at).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={palette.accent} />
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity hero ── */}
        <GlassCard>
          <View style={{ padding: 20, flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Avatar user={currentUser} size={64} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text
                style={{ fontSize: 20, fontWeight: "800", color: palette.ink, letterSpacing: -0.4 }}
                numberOfLines={1}
              >
                {currentUser.display_name || currentUser.username}
              </Text>
              <Text style={{ fontSize: 12, color: palette.soft }}>@{currentUser.username}</Text>
              <Text style={{ fontSize: 12, color: palette.soft }}>{currentUser.email}</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                <InfoChip
                  label={currentUser.role === "admin" ? "Admin" : "User"}
                  tone={currentUser.role === "admin" ? "warn" : "accent"}
                />
                <InfoChip label={`Since ${memberSince}`} tone="neutral" />
              </View>
            </View>
          </View>
        </GlassCard>

        {/* ── Edit profile ── */}
        <SectionLabel label="Edit profile" />
        <GlassCard>
          <View style={{ padding: 18, gap: 14 }}>
            <TextField
              label="Username"
              value={currentUser.username}
              editable={false}
              autoCapitalize="none"
            />
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
            <ActionButton
              label="Save changes"
              loading={saving}
              onPress={handleSave}
            />
          </View>
        </GlassCard>

        {/* ── Admin: user management ── */}
        {currentUser.role === "admin" && (
          <>
            <SectionLabel label="User management" />
            <GlassCard>
              {/* header */}
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
                {usersLoading && (
                  <ActivityIndicator size="small" color={palette.muted} />
                )}
              </View>
              <Divider />
              {users.length === 0 && !usersLoading ? (
                <View style={{ padding: 18 }}>
                  <Text style={{ fontSize: 13, color: palette.soft, textAlign: "center" }}>
                    No users found.
                  </Text>
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
                    />
                    {i < users.length - 1 && <Divider />}
                  </View>
                ))
              )}
            </GlassCard>
          </>
        )}

        {/* ── Sign out ── */}
        <SectionLabel label="Session" />
        <GlassCard>
          <Pressable
            onPress={handleSignOut}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 18,
              paddingVertical: 16,
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isDark ? "rgba(239,68,68,0.14)" : "rgba(239,68,68,0.09)",
                borderWidth: 1,
                borderColor: isDark ? "rgba(239,68,68,0.28)" : "rgba(239,68,68,0.18)",
              }}
            >
              <LogOut size={15} color={palette.danger} strokeWidth={2.2} />
            </View>
            <Text style={{ fontSize: 15, fontWeight: "600", color: palette.danger, letterSpacing: -0.1 }}>
              Sign out
            </Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
