import { createContext, useContext, createSignal, type JSX } from "solid-js"

interface LayoutState {
  sidebarOpen: boolean
  sidebarWidth: number
  panelOpen: boolean
  panelHeight: number
}

interface LayoutContextValue {
  state: () => LayoutState
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  togglePanel: () => void
  setPanelHeight: (height: number) => void
}

const LayoutContext = createContext<LayoutContextValue>()

export function LayoutProvider(props: { children: JSX.Element }) {
  const [state, setState] = createSignal<LayoutState>({
    sidebarOpen: true,
    sidebarWidth: 280,
    panelOpen: true,
    panelHeight: 200,
  })

  const toggleSidebar = () => {
    setState((prev) => ({ ...prev, sidebarOpen: !prev.sidebarOpen }))
  }

  const setSidebarWidth = (width: number) => {
    setState((prev) => ({ ...prev, sidebarWidth: width }))
  }

  const togglePanel = () => {
    setState((prev) => ({ ...prev, panelOpen: !prev.panelOpen }))
  }

  const setPanelHeight = (height: number) => {
    setState((prev) => ({ ...prev, panelHeight: height }))
  }

  return (
    <LayoutContext.Provider
      value={{
        state,
        toggleSidebar,
        setSidebarWidth,
        togglePanel,
        setPanelHeight,
      }}
    >
      {props.children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error("useLayout must be used within LayoutProvider")
  }
  return context
}
