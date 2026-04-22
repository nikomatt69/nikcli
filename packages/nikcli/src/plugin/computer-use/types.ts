// Computer-Use Plugin Types
// IPC protocol and runtime state types

export interface ScreenshotParams {
  app?: string
  windowTitle?: string
}

export interface ClickParams {
  x: number
  y: number
  captureId?: string
}

export interface TypeTextParams {
  text: string
}

export interface WaitParams {
  ms?: number
}

export interface CurrentTarget {
  appName: string
  bundleId?: string
  pid: number
  windowTitle: string
  windowId: number
}

export interface CurrentCapture {
  captureId: string
  width: number
  height: number
  scaleFactor: number
  timestamp: number
}

export interface ActivationFlags {
  activated: boolean
  unminimized: boolean
  raised: boolean
}

export interface ExecutionTrace {
  strategy: "screenshot" | "wait" | "ax_press" | "ax_focus" | "coordinate_event_click" | "ax_set_value" | "raw_key_text"
  axAttempted?: boolean
  axSucceeded?: boolean
  fallbackUsed?: boolean
}

export interface ComputerUseDetails {
  tool: string
  target: {
    app: string
    bundleId?: string
    pid: number
    windowTitle: string
    windowId: number
  }
  capture: {
    captureId: string
    width: number
    height: number
    scaleFactor: number
    timestamp: number
    coordinateSpace: "window-relative-screenshot-pixels"
  }
  activation: ActivationFlags
  execution: ExecutionTrace
}

export interface HelperApp {
  appName: string
  bundleId?: string
  pid: number
  isFrontmost?: boolean
}

export interface FramePoints {
  x: number
  y: number
  w: number
  h: number
}

export interface HelperWindow {
  windowId?: number
  title: string
  framePoints: FramePoints
  scaleFactor: number
  isMinimized: boolean
  isOnscreen: boolean
  isMain: boolean
  isFocused: boolean
}

export interface FrontmostResult {
  appName: string
  bundleId?: string
  pid: number
  windowTitle?: string
  windowId?: number
}

export interface ScreenshotPayload {
  pngBase64: string
  width: number
  height: number
  scaleFactor: number
}

export interface FocusedElementResult {
  exists: boolean
  elementRef?: string
  role?: string
  subrole?: string
  isTextInput?: boolean
  isSecure?: boolean
  canSetValue?: boolean
}

export interface AxPressAtPointResult {
  pressed: boolean
  reason?: string
}

export interface AxFocusResult {
  focused: boolean
  reason?: string
}

export interface ResolvedTarget extends CurrentTarget {
  framePoints: FramePoints
  scaleFactor: number
  isMinimized: boolean
  isOnscreen: boolean
  isMain: boolean
  isFocused: boolean
}

export interface PermissionStatus {
  accessibility: boolean
  screenRecording: boolean
}

export interface BridgeRequest {
  id: string
  cmd: string
  [key: string]: unknown
}

export interface BridgeResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: {
    message: string
    code: string
  }
}

// Tool result type compatible with nikcli
export interface ToolResult<T = unknown> {
  title: string
  output: string
  metadata: Record<string, unknown>
  details?: T
  attachments?: Array<{
    type: "file"
    mime: string
    url: string
    filename: string
  }>
}
