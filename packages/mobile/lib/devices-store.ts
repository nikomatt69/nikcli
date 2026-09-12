import * as SecureStore from "expo-secure-store"
import type { ServerConfig } from "@/lib/types"
import { deviceFromConfig, removeDevice, renameDevice, upsertDevice, type SavedDevice } from "@/lib/devices"

/**
 * Where the saved devices live.
 *
 * Kept apart from `devices.ts` so the list logic stays free of the native
 * storage module and can be exercised on its own.
 */

const DEVICES_KEY = "nikcli_devices"

export async function getSavedDevices(): Promise<SavedDevice[]> {
  const raw = await SecureStore.getItemAsync(DEVICES_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedDevice[]) : []
  } catch {
    return []
  }
}

export async function setSavedDevices(devices: SavedDevice[]): Promise<void> {
  await SecureStore.setItemAsync(DEVICES_KEY, JSON.stringify(devices))
}

/**
 * Record the host a connection just used.
 *
 * Called from the one place every connection funnels through, so a device is
 * saved whether it arrived from the connect screen, a pairing link, or a
 * workspace switch — and never twice.
 */
export async function rememberDevice(config: ServerConfig): Promise<SavedDevice[]> {
  const device = deviceFromConfig(config)
  if (!device) return getSavedDevices()
  const devices = upsertDevice(await getSavedDevices(), device)
  await setSavedDevices(devices)
  return devices
}

export async function forgetDevice(id: string): Promise<SavedDevice[]> {
  const devices = removeDevice(await getSavedDevices(), id)
  await setSavedDevices(devices)
  return devices
}

export async function setDeviceLabel(id: string, label: string): Promise<SavedDevice[]> {
  const devices = renameDevice(await getSavedDevices(), id, label)
  await setSavedDevices(devices)
  return devices
}
