import { NIKCLI_URL } from "./constants"

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = NIKCLI_URL) {
    this.baseUrl = baseUrl
  }

  async get<TResponse>(endpoint: string, options: RequestInit = {}): Promise<TResponse> {
    return this.request<TResponse>(endpoint, { ...options, method: "GET" })
  }

  async post<TResponse, TBody = unknown>(endpoint: string, body: TBody, options: RequestInit = {}): Promise<TResponse> {
    return this.request<TResponse>(endpoint, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  async put<TResponse, TBody = unknown>(endpoint: string, body: TBody, options: RequestInit = {}): Promise<TResponse> {
    return this.request<TResponse>(endpoint, {
      ...options,
      method: "PUT",
      body: JSON.stringify(body),
    })
  }

  async delete<TResponse>(endpoint: string, options: RequestInit = {}): Promise<TResponse> {
    return this.request<TResponse>(endpoint, { ...options, method: "DELETE" })
  }

  private async request<TResponse>(endpoint: string, options: RequestInit): Promise<TResponse> {
    const url = `${this.baseUrl}${endpoint}`
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    return (await response.json()) as TResponse
  }
}

export const api = new ApiClient()
