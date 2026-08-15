/**
 * Imports every module that registers a bus event via `BusEvent.schema`, for
 * side effects only. The Effect PublicApi contract calls `BusEvent.schemas()`
 * at module evaluation time (see `httpapi/contract-extra.ts`); that union is
 * complete only if every defining module has been loaded first — the Hono
 * server gets this for free from its route import graph, the Effect contract
 * gets it from this module. `BusEvent.schemas()` throws listing the missing
 * event types if this file falls out of date.
 */
import "@/bus/index"
import "@/bus/tui-event"
import "@/command/index"
import "@/delegation/manager"
import "@/file/index"
import "@/file/watcher"
import "@/ide/index"
import "@/installation/index"
import "@/loop/engine"
import "@/lsp/client"
import "@/lsp/index"
import "@/mcp/index"
import "@/mission/orchestrator"
import "@/monitor/manager"
import "@/observability/telemetry-bus"
import "@/permission/next"
import "@/project/project"
import "@/project/reload"
import "@/project/vcs"
import "@/pty/index"
import "@/question/index"
import "@/server/event"
import "@/session/compaction"
import "@/session/goal"
import "@/session/index"
import "@/session/message-v2"
import "@/session/status"
import "@/session/todo"
import "@/session/v2/projector"
import "@/workspace/connection"
import "@/workspace/index"
