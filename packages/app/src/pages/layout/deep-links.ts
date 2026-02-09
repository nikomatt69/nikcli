export const deepLinkEvent = "nikcli:deep-link"

export const parseDeepLink = (input: string) => {
  if (!input.startsWith("nikcli://")) return
  const url = new URL(input)
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

type NikcliWindow = Window & {
  __NIKCLI__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: NikcliWindow) => {
  const pending = target.__NIKCLI__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__NIKCLI__) target.__NIKCLI__.deepLinks = []
  return pending
}
