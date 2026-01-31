import { useContext } from "solid-js"
import { ApiContext } from "../context/api"

export function useApiClient() {
  const context = useContext(ApiContext)
  if (!context) {
    throw new Error("useApiClient must be used within ApiProvider")
  }
  return context
}
