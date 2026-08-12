import { handleSessionRequest } from "./session"
import { handleTeleportRequest } from "./teleport"
import { handleWorktreeRequest } from "./worktree"
import { handleGitRequest } from "./git"
import { handleAuthRequest } from "./auth"
import { handleMiscRequest } from "./misc"
import { handleMemoryRequest } from "./memory"
import { handleGithubRequest } from "./github"
import { handleSessionLifecycleRequest } from "./session-lifecycle"
import { handleLoopsRequest } from "./loops"
import { handlePtyRequest } from "./pty"

export async function dispatchMobileRequest(request: Request): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname
  if (pathname !== "/mobile" && !pathname.startsWith("/mobile/")) return
  return (
    (await handleAuthRequest(request)) ??
    (await handleMiscRequest(request)) ??
    (await handleMemoryRequest(request)) ??
    (await handleGithubRequest(request)) ??
    (await handleSessionLifecycleRequest(request)) ??
    (await handleSessionRequest(request)) ??
    (await handleTeleportRequest(request)) ??
    (await handleWorktreeRequest(request)) ??
    (await handleGitRequest(request)) ??
    (await handleLoopsRequest(request)) ??
    (await handlePtyRequest(request))
  )
}
