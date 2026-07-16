import { createContext, useContext } from "react"
import { buildMobileUrl, MobileResponseError, type MobileClient, parseMobileResponse } from "@/lib/client"
import type { MobileBootstrap, ServerConfig } from "@/lib/types"
import type { OAuthTokenTriple } from "@/lib/oauth-core"

export type UserProfile = {
  id: string
  username: string
  email: string
  display_name: string | null
  role: "admin" | "user"
  created_at: number
  updated_at: number
}

async function userFetch<T>(serverUrl: string, path: string, options?: RequestInit & { token?: string }): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (options?.token) headers["Authorization"] = `Bearer ${options.token}`
  const res = await fetch(buildMobileUrl({ url: serverUrl }, path), {
    ...options,
    headers,
  })
  return parseMobileResponse<T>(res, path)
}

export function userLogin(
  serverUrl: string,
  email: string,
  password: string,
): Promise<{ token: string; user: UserProfile }> {
  return userFetch(serverUrl, "/user/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
}

export function userRegister(
  serverUrl: string,
  data: {
    username: string
    email: string
    password: string
    displayName?: string
  },
  adminToken?: string,
): Promise<{ token: string; user: UserProfile }> {
  return userFetch(serverUrl, "/user/register", {
    method: "POST",
    body: JSON.stringify(data),
    token: adminToken,
  })
}

export async function userMe(
  serverUrl: string,
  token: string,
  refresh?: () => Promise<string | null>,
): Promise<UserProfile> {
  try {
    return await userFetch(serverUrl, "/user/me", { token })
  } catch (error) {
    if (!(error instanceof MobileResponseError) || error.status !== 401 || !refresh) throw error
    const nextToken = await refresh()
    if (!nextToken) throw error
    return userFetch(serverUrl, "/user/me", { token: nextToken })
  }
}

export function userLogoutApi(serverUrl: string, token: string): Promise<{ ok: boolean }> {
  return userFetch(serverUrl, "/user/logout", { method: "POST", token })
}

export function userStatus(serverUrl: string): Promise<{ hasUsers: boolean }> {
  return userFetch(serverUrl, "/user/status")
}

export function userList(serverUrl: string, token: string): Promise<UserProfile[]> {
  return userFetch(serverUrl, "/user/list", { token })
}

export function userUpdate(
  serverUrl: string,
  token: string,
  id: string,
  data: { displayName?: string; password?: string; role?: "admin" | "user" },
): Promise<UserProfile> {
  return userFetch(serverUrl, `/user/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  })
}

export function userDelete(serverUrl: string, token: string, id: string): Promise<{ ok: boolean }> {
  return userFetch(serverUrl, `/user/${id}`, { method: "DELETE", token })
}

export type ServerContextValue = {
  config: ServerConfig | null
  loading: boolean
  ready: boolean
  client: MobileClient | null
  bootstrap: MobileBootstrap | null
  bootstrapLoading: boolean
  currentUser: UserProfile | null
  userToken: string | null
  userLoading: boolean
  refreshBootstrap(): Promise<MobileBootstrap | null>
  save(config: ServerConfig): Promise<void>
  clear(): Promise<void>
  setUserSession(token: string, user: UserProfile): Promise<void>
  setOAuthSession(tokens: OAuthTokenTriple, user: UserProfile): Promise<void>
  signOut(): Promise<void>
}

export const ServerContext = createContext<ServerContextValue | undefined>(undefined)

export function useServer() {
  const value = useContext(ServerContext)
  if (!value) throw new Error("useServer must be used inside ServerProvider")
  return value
}
