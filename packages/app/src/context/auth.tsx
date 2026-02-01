import { createContext, useContext, createSignal, type JSX } from "solid-js"
import { NIKCLI_URL, NIKCLI_USERNAME, NIKCLI_PASSWORD } from "../lib/constants"

interface User {
  id: string
  name: string
}

interface Credentials {
  username: string
  password: string
}

interface AuthContextValue {
  user: () => User | null
  isAuthenticated: () => boolean
  token: () => string | null
  login: (credentials: Credentials) => Promise<boolean>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue>()

export function AuthProvider(props: { children: JSX.Element }) {
  const storedUser = readStorage("nikcli.auth.user")
  const storedToken = readStorage("nikcli.auth.token")
  const [user, setUser] = createSignal<User | null>(storedUser ? { id: storedUser, name: storedUser } : null)
  const [token, setToken] = createSignal<string | null>(storedToken)

  const isAuthenticated = () => token() !== null

  const login = async (credentials: Credentials) => {
    const username = credentials.username.trim()
    const password = credentials.password
    if (!username || !password) return false

    const auth = `Basic ${btoa(`${username}:${password}`)}`
    const ok = await verify(auth)
    if (!ok) return false

    setUser({ id: username, name: username })
    setToken(auth)
    writeStorage("nikcli.auth.user", username)
    writeStorage("nikcli.auth.token", auth)
    return true
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    clearStorage("nikcli.auth.user")
    clearStorage("nikcli.auth.token")
  }

  void resume({
    token: () => token(),
    login,
    logout,
  })

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, token, login, logout }}>
      {props.children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(key)
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key, value)
}

function clearStorage(key: string) {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(key)
}

async function verify(auth: string): Promise<boolean> {
  const response = await fetch(`${NIKCLI_URL}/global/health`, {
    headers: { Authorization: auth },
  })
  return response.ok
}

async function resume(args: {
  token: () => string | null
  login: (credentials: Credentials) => Promise<boolean>
  logout: () => void
}) {
  const saved = args.token()
  if (saved) {
    const ok = await verify(saved)
    if (ok) return
    args.logout()
    return
  }

  if (!NIKCLI_USERNAME || !NIKCLI_PASSWORD) return
  await args.login({ username: NIKCLI_USERNAME, password: NIKCLI_PASSWORD })
}
