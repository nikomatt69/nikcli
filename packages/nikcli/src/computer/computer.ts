/**
 * @deprecated Re-export of the `@nikcli-ai/computer-use` package API for
 * callers that historically imported from `@/computer/computer`. The actual
 * implementation now lives in `packages/computer-use`, mirroring how
 * `@nikcli-ai/browser-control` is consumed via `@/browser/browser`.
 *
 * The wrapper preserves the historical `Computer.backend(mode, sessionID)`
 * shape (returning a `Backend` instead of a `SessionManager`) so the
 * original `ComputerTool` could still talk directly to a backend; new code
 * should use the `SessionManager` + background daemon from the package
 * directly, the way the modern `Browser` namespace does for
 * `@nikcli-ai/browser-control`.
 */
import * as ComputerUse from "@nikcli-ai/computer-use";

export {
  // Frame
  type ComputerFrame,
  type Mode,
  type ScreenSize,
  emptyFrame,
  // Backends
  backend,
  hostBackend,
  sandboxBackend,
  type Backend,
  type Capabilities,
  type MouseButton,
  type Point,
  // Session
  ComputerSession,
  type SessionInfo,
  type SessionOptions,
  type SessionStatus,
  type SendMode,
  type WaitCondition,
  type WaitResult,
  SessionManager,
  // Recording
  Recorder,
  type RecordingData,
  type RecordingMarker,
  type SampledFrame,
  type StartRecordingOptions,
  // Evidence + render
  createEvidenceBundle,
  type EvidenceBundle,
  type EvidenceBundleOptions,
  type VerificationResult,
  renderJSON,
  renderPng,
  renderText,
  type JSONFrame,
  // Daemon client
  ensureDaemon,
  rpc,
  shutdownDaemon,
  socketPathFor,
} from "@nikcli-ai/computer-use";

// Legacy `Computer` namespace — preserves the original surface so the
// historical `ComputerTool` (and any third-party imports) keep working
// against the new package. Mirrors how the old in-tree code was organized:
// everything reachable as `Computer.<symbol>`.
export const Computer = {
  ...ComputerUse,
  Sandbox: ComputerUse.Sandbox,
  SandboxImage: ComputerUse.SandboxImage,
} as const;

// Also export `Sandbox` and `SandboxImage` as named exports so the legacy
// `import { Sandbox } from "@/computer/computer"` import path keeps working
// alongside the dedicated `@/computer/sandbox` re-export shim.
export const Sandbox = ComputerUse.Sandbox;
export const SandboxImage = ComputerUse.SandboxImage;
