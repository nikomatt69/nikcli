import { Hono } from "hono"
import { lazy } from "@/util/lazy"
import { AuthRoutes } from "./auth"
import { MiscRoutes } from "./misc"
import { MemoryRoutes } from "./memory"
import { GithubRoutes } from "./github"
import { SessionRoutes } from "./session"
import { SessionLifecycleRoutes } from "./session-lifecycle"
import { TeleportRoutes } from "./teleport"
import { WorkspaceRoutes } from "./workspace"
import { GitRoutes } from "./git"
import { LoopsRoutes } from "./loops"
import { PtyRoutes } from "./pty"

export const MobileRoutes = lazy(() =>
  new Hono()
    .route("", AuthRoutes())
    .route("", MiscRoutes())
    .route("", MemoryRoutes())
    .route("", GithubRoutes())
    .route("", SessionRoutes())
    .route("", SessionLifecycleRoutes())
    .route("", TeleportRoutes())
    .route("", WorkspaceRoutes())
    .route("", GitRoutes())
    .route("", LoopsRoutes())
    .route("", PtyRoutes()),
)
