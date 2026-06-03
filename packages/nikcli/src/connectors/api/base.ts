import { Schema } from "effect"

export abstract class BaseApiClient<AuthConfig extends Record<string, string>> {
  protected abstract baseUrl: string

  protected abstract getAuth(authConfig: AuthConfig): Record<string, string>

  protected async request<T>(
    path: string,
    options: RequestInit & { query?: Record<string, string | number>; auth?: AuthConfig } = {},
  ): Promise<T> {
    let url = path.startsWith("http") ? path : `${this.baseUrl}${path}`

    if (options.query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(options.query)) {
        params.append(key, String(value))
      }
      const separator = url.includes("?") ? "&" : "?"
      url += separator + params.toString()
    }

    const { query, auth, ...fetchOptions } = options
    const authHeaders = auth ? this.getAuth(auth) : {}

    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        ...authHeaders,
        ...fetchOptions.headers,
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      throw new ApiError({
        message: `${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
        status: response.status,
      })
    }

    return response.json()
  }

  protected async get<T>(
    path: string,
    options?: Omit<RequestInit, "method"> & { query?: Record<string, string | number>; auth?: AuthConfig },
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" })
  }

  protected async post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestInit, "method" | "body"> & { auth?: AuthConfig },
  ): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: "POST",
      headers: {
        ...options?.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  }
}

export class ApiError extends Schema.TaggedErrorClass<ApiError>()("ApiError", {
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}
