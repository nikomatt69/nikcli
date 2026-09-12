import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native"
import { router } from "expo-router"
import { Plus, Server, Trash2 } from "lucide-react-native"
import { Tappable } from "@/components/ui/Tappable"
import { ActionButton } from "@/components/ui/ActionButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { SectionHeader } from "@/components/ui/SectionHeader"
import { SessionRenameSheet } from "@/components/session/SessionRenameSheet"
import { useServer } from "@/lib/server-context"
import { activeDevice, configForDevice, isSameDevice, sortDevices, type SavedDevice } from "@/lib/devices"
import { forgetDevice, getSavedDevices, setDeviceLabel } from "@/lib/devices-store"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

function relativeAge(at: number | undefined): string {
  if (!at) return "never used"
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

type DeviceRowProps = {
  device: SavedDevice
  active: boolean
  /** Host version and reachability, known only for the device in use. */
  status?: string
  switching: boolean
  onSwitch(): void
  onRename(): void
  onForget(): void
}

function DeviceRow({ device, active, status, switching, onSwitch, onRename, onForget }: DeviceRowProps) {
  const { palette } = useAppTheme()

  return (
    <View
      style={{
        borderRadius: 18,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: active ? hexToRgba(palette.ink, 0.18) : hexToRgba(palette.ink, 0.08),
        backgroundColor: palette.surfaceRaised,
        overflow: "hidden",
      }}
    >
      <Tappable
        accessibilityRole="button"
        accessibilityLabel={`${device.label}${active ? ", in use" : ""}`}
        accessibilityHint={active ? "Opens host status" : "Switches to this device"}
        onPress={onSwitch}
        onLongPress={onRename}
        delayLongPress={380}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: hexToRgba(palette.ink, 0.05),
            borderWidth: 1,
            borderColor: hexToRgba(palette.ink, 0.08),
          }}
        >
          <Server size={18} color={palette.ink} strokeWidth={2} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: palette.ink, ...typeStyle(16, { weight: "600" }) }}>
            {device.label}
          </Text>
          <Text numberOfLines={1} style={{ color: palette.muted, ...typeStyle(13) }}>
            {device.url}
          </Text>
          <Text numberOfLines={1} style={{ color: palette.muted, ...typeStyle(13) }}>
            {active ? (status ?? "In use") : relativeAge(device.lastUsedAt)}
          </Text>
        </View>

        {switching ? (
          <ActivityIndicator size="small" color={palette.muted} />
        ) : active ? (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: hexToRgba(palette.success, 0.12),
            }}
          >
            <Text style={{ color: palette.success, ...typeStyle(12, { weight: "600" }) }}>In use</Text>
          </View>
        ) : null}
      </Tappable>

      <View style={{ height: 1, backgroundColor: hexToRgba(palette.ink, 0.06) }} />

      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Tappable
          accessibilityRole="button"
          accessibilityLabel={`Rename ${device.label}`}
          onPress={onRename}
          style={{ flex: 1, alignItems: "center", paddingVertical: 12 }}
        >
          <Text style={{ color: palette.ink, ...typeStyle(14, { weight: "500" }) }}>Rename</Text>
        </Tappable>
        <View style={{ width: 1, alignSelf: "stretch", backgroundColor: hexToRgba(palette.ink, 0.06) }} />
        <Tappable
          accessibilityRole="button"
          accessibilityLabel={`Forget ${device.label}`}
          onPress={onForget}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 12,
          }}
        >
          <Trash2 size={15} color={palette.danger} strokeWidth={2} />
          <Text style={{ color: palette.danger, ...typeStyle(14, { weight: "500" }) }}>Forget</Text>
        </Tappable>
      </View>
    </View>
  )
}

/**
 * Every host this app can drive, and the ways in and out of them: switch to
 * one, name it, forget it, or add another. The device in use is whatever
 * `ServerConfig` points at, so switching here is what every other screen reads.
 */
export default function DevicesScreen() {
  const { palette } = useAppTheme()
  const { config, bootstrap, bootstrapLoading, save } = useServer()
  const [devices, setDevices] = useState<SavedDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<SavedDevice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setDevices(sortDevices(await getSavedDevices()))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const current = activeDevice(devices, config)

  async function switchTo(device: SavedDevice) {
    if (config && isSameDevice(device.url, config.url)) {
      router.push("/more/host")
      return
    }
    try {
      setSwitching(device.id)
      setError(null)
      await save(configForDevice(device, config))
      void triggerHaptic("success")
      router.replace("/sessions")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      void triggerHaptic("error")
    } finally {
      setSwitching(null)
    }
  }

  function confirmForget(device: SavedDevice) {
    const inUse = Boolean(config && isSameDevice(device.url, config.url))
    Alert.alert(
      `Forget ${device.label}?`,
      inUse
        ? "This device is in use. Its saved credentials are removed; the app stays connected until you switch or reconnect."
        : "Its URL and saved credentials are removed from this app.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setDevices(sortDevices(await forgetDevice(device.id)))
              void triggerHaptic("success")
            })()
          },
        },
      ],
    )
  }

  const hostStatus = bootstrapLoading ? "Checking…" : bootstrap ? `v${bootstrap.version} · Connected` : "Not reachable"

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 12 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={palette.muted} />}
      >
        {error ? <ErrorBanner message={error} /> : null}

        <Text style={{ color: palette.muted, ...typeStyle(14) }}>
          nikcli drives one host at a time. Everything you connect to is kept here, so switching back takes a tap.
        </Text>

        <ActionButton label="Add device" onPress={() => router.push("/connect")} />

        {loading ? (
          <ActivityIndicator color={palette.muted} style={{ marginTop: 24 }} />
        ) : devices.length === 0 ? (
          <EmptyState
            title="No devices yet"
            description="Connect to a nikcli host — a laptop, a server, a container — and it shows up here."
            action={
              <ActionButton label="Connect a device" onPress={() => router.push("/connect")} variant="secondary" />
            }
          />
        ) : (
          <>
            <SectionHeader label={devices.length === 1 ? "1 device" : `${devices.length} devices`} />
            <View style={{ gap: 12 }}>
              {devices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  active={device.id === current?.id}
                  status={device.id === current?.id ? hostStatus : undefined}
                  switching={switching === device.id}
                  onSwitch={() => void switchTo(device)}
                  onRename={() => setRenaming(device)}
                  onForget={() => confirmForget(device)}
                />
              ))}
            </View>
          </>
        )}

        {config && !current ? (
          <Text style={{ color: palette.muted, ...typeStyle(13) }}>
            Connected to {config.url}, which is not saved yet — reconnect from Add device to keep it.
          </Text>
        ) : null}

        <Tappable
          accessibilityRole="button"
          accessibilityLabel="Add device"
          onPress={() => router.push("/connect")}
          style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, alignSelf: "center" }}
        >
          <Plus size={17} color={palette.muted} strokeWidth={2.2} />
          <Text style={{ color: palette.muted, ...typeStyle(14, { weight: "500" }) }}>Add another device</Text>
        </Tappable>
      </ScrollView>

      <SessionRenameSheet
        visible={Boolean(renaming)}
        currentTitle={renaming?.label ?? ""}
        saving={false}
        subject={{
          eyebrow: "Rename device",
          heading: "Name this device",
          placeholder: "Laptop, work server, sandbox…",
          noun: "device",
        }}
        onClose={() => setRenaming(null)}
        onSave={(label) => {
          const target = renaming
          setRenaming(null)
          if (!target) return
          void (async () => {
            setDevices(sortDevices(await setDeviceLabel(target.id, label)))
            void triggerHaptic("success")
          })()
        }}
      />
    </View>
  )
}
