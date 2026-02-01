import { createContext, useContext, createSignal, type JSX } from "solid-js"
import { APP_VERSION } from "../lib/constants"

interface AppState {
  version: string
  isLoading: boolean
  error: string | null
}

interface AppContextValue {
  state: () => AppState
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

const AppContext = createContext<AppContextValue>()

export function AppProvider(props: { children: JSX.Element }) {
  const [state, setState] = createSignal<AppState>({
    version: APP_VERSION,
    isLoading: false,
    error: null,
  })

  const setLoading = (loading: boolean) => {
    setState((prev) => ({ ...prev, isLoading: loading }))
  }

  const setError = (error: string | null) => {
    setState((prev) => ({ ...prev, error }))
  }

  return <AppContext.Provider value={{ state, setLoading, setError }}>{props.children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error("useApp must be used within AppProvider")
  }
  return context
}

export type { AppState }
