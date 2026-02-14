import type {
  AppendMessageInput,
  CloudClientConfig,
  CloudDevice,
  CloudErrorPayload,
  CloudMessage,
  CloudSession,
  CloudSyncOperation,
  CloudUser,
  PullSyncInput,
  PushSyncInput,
  RegisterDeviceInput,
  UpsertSessionInput,
} from "./types.js"

type RelaySocketFactory = (url: string) => WebSocket

export class CloudClientError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message)
    this.name = "CloudClientError"
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface RelaySocketOptions {
  deviceID?: string
  webSocketFactory?: RelaySocketFactory
}

export class NikcliCloudClient {
  private readonly baseUrl: URL
  private readonly customFetch: typeof fetch
  private readonly getToken: () => Promise<string>
  private readonly staticHeaders: Record<string, string>

  constructor(config: CloudClientConfig) {
    this.baseUrl = new URL(config.baseUrl)
    this.customFetch = config.fetch ?? fetch
    this.staticHeaders = { ...(config.headers ?? {}) }

    if (config.getToken) {
      this.getToken = async () => config.getToken!()
    } else if (config.token) {
      const token = config.token
      this.getToken = async () => token
    } else {
      throw new CloudClientError("Missing authentication token provider", 401, "MISSING_TOKEN")
    }
  }

  private buildURL(pathname: string): URL {
    return new URL(pathname, this.baseUrl)
  }

  private async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", pathname: string, body?: unknown): Promise<T> {
    const token = await this.getToken()
    if (!token) {
      throw new CloudClientError("Authentication token is empty", 401, "MISSING_TOKEN")
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...this.staticHeaders,
    }

    const response = await this.customFetch(this.buildURL(pathname), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    const text = await response.text()
    const isJson = response.headers.get("content-type")?.includes("application/json") ?? false
    const parsed = isJson && text ? (JSON.parse(text) as unknown) : (text as unknown)

    if (!response.ok) {
      const payload = (typeof parsed === "object" && parsed ? parsed : {}) as CloudErrorPayload
      throw new CloudClientError(
        payload.error?.message || `Cloud request failed with status ${response.status}`,
        response.status,
        payload.error?.code,
        payload.error?.details,
      )
    }

    return parsed as T
  }

  me(): Promise<CloudUser> {
    return this.request<CloudUser>("GET", "/auth/me")
  }

  async registerDevice(input: RegisterDeviceInput): Promise<CloudDevice> {
    const result = await this.request<{ ok: true; device: CloudDevice }>("POST", "/auth/device/register", input)
    return result.device
  }

  async listDevices(): Promise<CloudDevice[]> {
    const result = await this.request<{ devices: CloudDevice[] }>("GET", "/devices")
    return result.devices
  }

  async listSessions(limit?: number): Promise<CloudSession[]> {
    const query = limit ? `?limit=${limit}` : ""
    const result = await this.request<{ sessions: CloudSession[] }>("GET", `/sessions${query}`)
    return result.sessions
  }

  async getSession(sessionID: string): Promise<CloudSession> {
    const result = await this.request<{ session: CloudSession }>("GET", `/sessions/${encodeURIComponent(sessionID)}`)
    return result.session
  }

  async upsertSession(sessionID: string, input: UpsertSessionInput): Promise<CloudSession> {
    const result = await this.request<{ session: CloudSession }>(
      "PUT",
      `/sessions/${encodeURIComponent(sessionID)}`,
      input,
    )
    return result.session
  }

  async deleteSession(sessionID: string): Promise<void> {
    await this.request<{ ok: true }>("DELETE", `/sessions/${encodeURIComponent(sessionID)}`)
  }

  async listMessages(sessionID: string, options?: { after?: number; limit?: number }): Promise<CloudMessage[]> {
    const params = new URLSearchParams()
    if (typeof options?.after === "number") params.set("after", String(options.after))
    if (typeof options?.limit === "number") params.set("limit", String(options.limit))
    const queryStr = params.toString()
    const query = queryStr ? `?${queryStr}` : ""

    const result = await this.request<{ messages: CloudMessage[] }>(
      "GET",
      `/sessions/${encodeURIComponent(sessionID)}/messages${query}`,
    )
    return result.messages
  }

  async appendMessage(sessionID: string, input: AppendMessageInput): Promise<CloudMessage> {
    const result = await this.request<{ message: CloudMessage }>(
      "POST",
      `/sessions/${encodeURIComponent(sessionID)}/messages`,
      input,
    )
    return result.message
  }

  async pushSync(input: PushSyncInput): Promise<{ ok: true; applied: number; cursor: number }> {
    return this.request<{ ok: true; applied: number; cursor: number }>("POST", "/sync/push", input)
  }

  async pullSync(input: PullSyncInput): Promise<{ operations: CloudSyncOperation[]; cursor: number }> {
    return this.request<{ operations: CloudSyncOperation[]; cursor: number }>("POST", "/sync/pull", input)
  }

  async openRelaySocket(sessionID: string, options?: RelaySocketOptions): Promise<WebSocket> {
    const token = await this.getToken()
    if (!token) {
      throw new CloudClientError("Authentication token is empty", 401, "MISSING_TOKEN")
    }

    const relayPath = `/relay/${encodeURIComponent(sessionID)}`
    const url = new URL(relayPath, this.baseUrl)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.searchParams.set("token", token)
    if (options?.deviceID) {
      url.searchParams.set("deviceID", options.deviceID)
    }

    const factory = options?.webSocketFactory ?? ((relayUrl: string) => new WebSocket(relayUrl))
    return factory(url.toString())
  }
}

export function createNikcliCloudClient(config: CloudClientConfig): NikcliCloudClient {
  return new NikcliCloudClient(config)
}
