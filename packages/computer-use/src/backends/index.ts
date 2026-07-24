/**
 * Backend selector — return the right `Backend` for a mode + conversation,
 * the way `@nikcli-ai/browser-control`'s `SessionManager` picks a backend per
 * session. `sandbox` (default) keeps one Docker-managed Linux desktop per
 * nikcli conversation; `host` drives the user's real desktop in real time.
 */
import type { Mode } from "../frame";
import type { Backend } from "./host";
import { hostBackend } from "./host";
import { sandboxBackend } from "./sandbox";

export type { Backend, Capabilities, MouseButton, Point } from "./host";
export { hostBackend } from "./host";
export { sandboxBackend } from "./sandbox";

/** Resolve the backend for a mode + conversation. */
export function backend(mode: Mode, sessionID: string): Backend {
  return mode === "host" ? hostBackend : sandboxBackend(sessionID);
}
