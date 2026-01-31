import { useContext } from "solid-js"
import { AuthContext } from "../context/auth"

export function useAuthHook() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuthHook must be used within AuthProvider")
  }
  return context
}
