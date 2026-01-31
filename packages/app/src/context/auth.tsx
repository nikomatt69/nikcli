import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface User {
  id: string
  name: string
  email: string
  avatar?: string
}

interface AuthContextValue {
  user: () => User | null
  isAuthenticated: () => boolean
  login: () => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue>()

export function AuthProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<User | null>(null)

  const isAuthenticated = () => user() !== null

  const login = async () => {
    // TODO: Implement OAuth with auth.nikcli.store
    console.log("Login not implemented")
  }

  const logout = () => {
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, isAuthenticated, login, logout }}>{props.children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}
