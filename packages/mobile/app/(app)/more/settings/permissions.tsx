import { useCallback, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { Check } from "lucide-react-native"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { useServer } from "@/lib/server-context"
import {
  PERMISSION_ACTIONS,
  PERMISSION_ITEMS,
  PERMISSION_PRESETS,
  detectPermissionMode,
  getPermissionActionFor,
  permissionModeDescription,
  permissionModeTitle,
  permissionPresetPatch,
  toPermissionMap,
  type PermissionAction,
  type PermissionMap,
  type PermissionPreset,
} from "@/lib/permission-presets"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import type { HostConfigSnapshot } from "@/lib/types"

export default function PermissionsSettingsScreen() {
  const { client } = useServer()
  const { palette, isDark } = useAppTheme()
  const [permission, setPermission] = useState<PermissionMap>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const mode = useMemo(() => detectPermissionMode(permission), [permission])

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setMessage(null)
      const config = await client.getConfig()
      setPermission(toPermissionMap(config.permission))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function applyPreset(preset: PermissionPreset) {
    if (!client || saving) return
    const before = permission
    const patch = permissionPresetPatch(preset)
    const next = { ...toPermissionMap(before), ...patch }
    setPermission(next)
    try {
      setSaving(true)
      setMessage(null)
      void triggerHaptic("selection")
      await client.updateConfig({ permission: patch } as HostConfigSnapshot)
    } catch (error) {
      setPermission(before)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function setToolAction(id: string, action: PermissionAction) {
    if (!client || saving) return
    const before = permission
    const existing = before[id]
    const nextValue =
      existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing, "*": action } : action
    const next = { ...before, [id]: nextValue }
    setPermission(next)
    try {
      setSaving(true)
      setMessage(null)
      void triggerHaptic("selection")
      await client.updateConfig({ permission: { [id]: nextValue } } as HostConfigSnapshot)
    } catch (error) {
      setPermission(before)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Permissions" }} />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {message ? <ErrorBanner message={message} /> : null}

        <SurfaceCard>
          <Text className="text-[12px] font-medium text-muted">Presets</Text>
          <Text className="mt-1 text-[15px] font-semibold text-ink">{permissionModeTitle(mode)}</Text>
          <Text className="mt-1 text-[13px] leading-[18px] text-soft">{permissionModeDescription(mode)}</Text>

          <View className="mt-4 gap-2">
            {PERMISSION_PRESETS.map((preset) => {
              const active = mode === preset
              return (
                <Pressable
                  key={preset}
                  disabled={saving || loading}
                  onPress={() => void applyPreset(preset)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => ({
                    borderRadius: 14,
                    borderWidth: 1,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    opacity: pressed ? 0.78 : 1,
                    backgroundColor: active
                      ? hexToRgba(palette.accentLight, 0.12)
                      : isDark
                        ? "rgba(255,255,255,0.04)"
                        : "rgba(20,20,19,0.03)",
                    borderColor: active
                      ? hexToRgba(palette.accentLight, 0.28)
                      : isDark
                        ? "rgba(255,255,255,0.1)"
                        : "rgba(20,20,19,0.1)",
                  })}
                >
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] font-semibold text-ink">{permissionModeTitle(preset)}</Text>
                      <Text className="mt-1 text-[12px] leading-4 text-soft">{permissionModeDescription(preset)}</Text>
                    </View>
                    {active ? <Check size={16} color={palette.accentLight} strokeWidth={2.4} /> : null}
                  </View>
                </Pressable>
              )
            })}
          </View>
        </SurfaceCard>

        <SurfaceCard>
          <Text className="text-[12px] font-medium text-muted">Tools</Text>
          <Text className="mt-1 text-[15px] font-semibold text-ink">Per-tool rules</Text>
          <Text className="mt-1 text-[13px] leading-[18px] text-soft">
            Override individual tools. Choosing Ask, Allow, or Deny here switches the host into Custom mode when it no
            longer matches a preset.
          </Text>

          <View className="mt-4">
            {PERMISSION_ITEMS.map((item, index) => {
              const current = getPermissionActionFor(permission, item.id)
              return (
                <View
                  key={item.id}
                  style={{
                    paddingVertical: 12,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: isDark ? "rgba(255,255,255,0.08)" : hexToRgba(palette.ink, 0.08),
                  }}
                >
                  <Text className="text-[14px] font-semibold text-ink">{item.title}</Text>
                  <Text className="mt-1 text-[12px] leading-4 text-soft">{item.description}</Text>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {PERMISSION_ACTIONS.map((action) => {
                      const active = current === action.value
                      return (
                        <Pressable
                          key={action.value}
                          disabled={saving || loading}
                          onPress={() => void setToolAction(item.id, action.value)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={({ pressed }) => ({
                            borderRadius: 999,
                            borderWidth: 1,
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                            opacity: pressed ? 0.72 : 1,
                            backgroundColor: active
                              ? hexToRgba(palette.accentLight, 0.16)
                              : hexToRgba(palette.ink, 0.06),
                            borderColor: active ? hexToRgba(palette.accentLight, 0.32) : hexToRgba(palette.ink, 0.12),
                          })}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: active ? "700" : "600",
                              color: active ? palette.accentLight : palette.soft,
                            }}
                          >
                            {action.label}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
              )
            })}
          </View>
        </SurfaceCard>
      </ScrollView>
    </>
  )
}
