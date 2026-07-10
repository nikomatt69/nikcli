export type SessionLiveActivityProps = {
  sessionID: string
  status: string
  action: string
  repository: string
  branch: string
  startedAt: number
  timerEndsAt?: number
  attention: boolean
  reviewURL: string
  approveURL?: string
  stopURL?: string
}

export type SessionLiveActivityHandle = {
  update(props: SessionLiveActivityProps): Promise<void>
  end(
    dismissalPolicy?: "default" | "immediate" | { after: Date },
    props?: SessionLiveActivityProps,
    contentDate?: Date,
  ): Promise<void>
}

export function startSessionLiveActivity(
  _props: SessionLiveActivityProps,
  _url: string,
): SessionLiveActivityHandle | null {
  return null
}

export function getSessionLiveActivityInstances(): SessionLiveActivityHandle[] {
  return []
}
