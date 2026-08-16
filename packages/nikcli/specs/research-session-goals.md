# Session Orchestration & Goal Machinery (research)

Read-only survey of `packages/nikcli`. File references are relative to
`src/` unless stated otherwise. Line ranges are approximate (files move).

## 1. Session lifecycle

### 1.1 The `Session` namespace — `session/index.ts`

- `Session.InfoSchema` (Effect Schema) is the session record. Fields include
  `id` (descending `session` id), `slug`, `projectID`, `directory`,
  `parentID`, `workspaceID`, `summary`, `share`, `github`, `worktree`,
  `mobile`, `title`, `activeCommand`, `time`, `permission`, `skills`,
  `disabledInstructions`, `disabledTools`, `revert`. — `session/index.ts:123-186`
- Zod input/output pair: `Info = zodObject(InfoSchema)`; `CreateInput` and
  `ForkInput` are zod. — `session/index.ts:187-226`
- `Session.Event` (bus events) — `session.created`, `session.updated`
  (`SessionPrimitives.EventName.updated`), `session.deleted`,
  `session.diff`, `session.error`, `session.pending.promoted`,
  `session.instructions.updated`. — `session/index.ts:260-308`

**Create** — `createNextImpl` builds the `Info` record (descending ID via
`Identifier.descending("session")`, `Slug.create()`, default title), persists it
through the sync projector (`SessionSync.Created`), optionally auto-shares, and
fires `SessionSync.Updated`. — `session/index.ts:444-503`

**Update** — `updateImpl` clones the existing row, runs the caller's editor,
touches `time.updated` (unless `touch:false`), and routes the write through
`SyncEvent.run(SessionSync.Updated, …)` rather than writing directly. The event
carries the whole session and its projector performs the SQL write.
— `session/index.ts:339-360`

**Delete** — `removeImpl` records analytics, recurses into children, unshares,
removes messages/parts, `SessionDiffRepo.remove`, and `GoalRepo.remove(sessionID)`
(lines 640-643), then fires `SessionSync.Deleted`. — `session/index.ts:549-649`

The service wrapper is `Session.Service` (`Context.Service`), built by
`Session.layer` (`Layer.succeed`) at `session/index.ts:888-1100`. Errors are
normalized into a closed union `Session.Error` (`BusyError | NotFoundError |
IOError`) via `asSessionError`. — `session/index.ts:836-904`

### 1.2 Message V2 parts — `session/message-v2.ts`

`MessageV2` is the canonical message/part model (Effect Schema + derived zod).

- Common part fields `PartBaseFields = { id, sessionID, messageID }`.
  — `message-v2.ts:179-183`
- Individual part schemas: `SnapshotPartSchema`, `PatchPartSchema`,
  `TextPartSchema` (with `synthetic`/`ignored` flags), `ReasoningPartSchema`,
  `FilePartSchema`, `AgentPartSchema`, `CompactionPartSchema`,
  `SubtaskPartSchema`, `RetryPartSchema`, `StepStartPartSchema`,
  `StepFinishPartSchema`. — `message-v2.ts:185-365`
- Tool state is a discriminated union `ToolStateSchema`
  (`pending | running | completed | error`) — `message-v2.ts:367-439`;
  `ToolPartSchema` wraps it with `callID`, `tool`, `state`.
  — `message-v2.ts:441-450`
- `PartSchema` is the union of all part types, discriminated on `type`.
  — `message-v2.ts:483-498`
- Messages: `UserSchema` (role `user`) and `AssistantSchema` (role `assistant`,
  carries `parentID`, `modelID`, `providerID`, `cost`, `tokens`, `finish`,
  `error`). `InfoSchema` is the `User | Assistant` union.
  — `message-v2.ts:452-556`
- `WithPartsSchema = { info: InfoSchema, parts: Array<PartSchema> }` — this is
  the "message with its parts" unit used everywhere (persistence, HTTP, prompts).
  — `message-v2.ts:589-594`
- `MessageV2.Event` — `message.updated`, `message.removed`,
  `message.part.updated`, `message.part.removed`. — `message-v2.ts:558-587`
- Persistence reads go through SQL (`MessageRepo`): `stream`, `page`, `parts`,
  `get`. — `message-v2.ts:958-1038`

### 1.3 Prompt round-trip (user message → prompt → provider → parts → render)

1. **Admit** — `admit(input)` persists the user message + parts
   (`prepareUserMessage`) and returns an `Admission`, with a pending/queue path
   for `noReply`. — `prompt.ts:413-523`
2. **Prepare user message** — `prepareUserMessage` resolves the agent, model,
   variant; materializes file/media/MCP/agent parts into synthetic text parts
   (e.g. `Called the Read tool …`) and emits a `chat.message` plugin hook.
   — `prompt.ts:1334-1756`
3. **Prompt** — `prompt(input)` calls `admit`, then `loop(...)`.
   — `prompt.ts:525-546`
4. **Loop** — `loop()` starts `PromptState` and runs `runLoop` async.
   — `prompt.ts:644-659`
5. **Run loop** — `runLoop(sessionID, controller)` is the agent turn loop
   (see §6). It assembles the system prompt (`InstructionSync.assemble`),
   converts stored `WithParts` messages to provider `ModelMessage[]`
   (`MessageV2.toModelMessages`), and calls
   `SessionProcessor.process({ user, agent, system, messages, tools, model })`.
   — `prompt.ts:1030-1168`
6. **Provider** — `processor.process` calls `LLM.stream(streamInput)` and
   consumes `stream.fullStream` events, translating each AI-SDK chunk into
   `MessageV2.Part` writes (`reasoning-start/delta/end`, `tool-input-start`,
   `text-delta`, `finish`), publishing `message.part.updated` and persisting
   parts. — `processor.ts:253-620`
7. **Render** — parts are persisted via `Session.updatePart` →
   `MessageRepo` and surfaced to clients through the bus
   (`message.part.updated`) and HTTP (see `server/httpapi/session.ts` which
   serves `MessageV2.WithPartsSchema`).

`MessageV2.toModelMessages` is where stored parts become provider messages:
user text/file/compaction/subtask parts → `UIMessage`, assistant text/tool
(`tool-<name>` with `output-available`/`output-error`)/reasoning/step-start
parts → `UIMessage`; media attachments are injected as follow-up user messages
for providers that cannot carry media in tool results. — `message-v2.ts:694-942`

## 2. The goal subsystem

Files: `session/goal.ts` (service + schema), `session/goal-repo.ts` (SQL repo),
`session/goal.sql.ts` (table), `tool/goal.ts` (the three tools).

### 2.1 Schema — `session/goal.ts`

- `StatusEffect` — `active | paused | blocked | usage_limited |
  budget_limited | complete`. — `goal.ts:11-18`
- `StateEffect` — the goal state: `sessionID`, `goalID`, `objective`,
  `status`, optional `tokenBudget`, `tokensUsed`, `timeUsedSeconds`,
  `iterationCount`, `timeCreated`, `timeUpdated`. — `goal.ts:22-33`
- `MAX_ITERATIONS = 50`. — `goal.ts:9`
- `SessionGoal.Event.Updated` — bus event `"session.goal"` carrying
  `{ sessionID, goal: State | null }`. Published on every create/update/clear.
  — `goal.ts:37-46`, `publishGoal` at `goal.ts:75-77`

### 2.2 Service interface — `goal.ts:52-73`

`SessionGoal.Service` methods: `get`, `set`, `updateStatus`, `accountUsage`,
`incrementIteration`, `pause`, `resume`, `usageLimit`, `clear`,
`isGoalContinueNeeded`, `isIterationLimitReached`, `continuationPrompt`,
`budgetLimitPrompt`, `iterationLimitPrompt`.

Implementation details:

- `setImpl` creates a fresh state with `Identifier.ascending("goal")`, status
  `active`, zero counters. — `goal.ts:83-100`
- `updateStatusImpl` mutates the row and republishes. — `goal.ts:102-110`
- `accountUsageImpl` accumulates `tokensUsed`/`timeUsedSeconds` and flips
  status to `budget_limited` when `tokenBudget` is exceeded.
  — `goal.ts:112-124`
- `incrementIterationImpl` bumps `iterationCount`. — `goal.ts:126-134`
- `isGoalContinueNeeded` returns true for `active` **or** `budget_limited`
  (i.e. the loop keeps driving until `complete`, `blocked`, `paused`, or
  `usage_limited`). — `goal.ts:141-143`
- `isIterationLimitReached` compares `iterationCount >= MAX_ITERATIONS`.
  — `goal.ts:145-147`
- The prompts are assembled in `continuationPrompt` (163-178),
  `budgetLimitPrompt` (180-194), `iterationLimitPrompt` (196-210).
- `parseArguments` splits the `/goal`-style string into a subcommand
  (`pause|resume|clear|status`) or an objective with optional
  `--token-budget N`. — `goal.ts:212-230`

### 2.3 Persistence — `session/goal-repo.ts` + `session/goal.sql.ts`

One row per session: `session_goal(session_id PK, data JSON, updated_at)`.
`data` stores the whole `SessionGoal.State` (single live goal per session).
— `goal.sql.ts:14-18`

`GoalRepo.get/upsert/update/remove` are synchronous over `Database.syncDb()`;
`readState` sanitizes corrupt rows (drops rather than surfaces).
— `goal-repo.ts:17-68`

### 2.4 The tools — `tool/goal.ts`

- `create_goal` — `Tool.define("create_goal", …)`; sets/replaces the active
  goal via `service.set`, then sets `session.activeCommand = "goal"`.
  Params: `{ objective: string, tokenBudget?: number }`. — `tool/goal.ts:8-75`
- `get_goal` — reads the current goal. — `tool/goal.ts:77-100`
- `update_goal` — `service.updateStatus(sessionID, status)` with
  `status ∈ { "complete", "blocked" }`, then clears `activeCommand`.
  — `tool/goal.ts:102-129`

### 2.5 Where "complete only after evidence" is enforced

There is **no code guard** that blocks `update_goal("complete")` without
evidence — the tool trusts the model. The convention is enforced entirely
through prompt text in three places:

1. Tool description — `update_goal`:
   > "Call with status \"complete\" only after verifying every requirement is
   > satisfied. Call with status \"blocked\" only when the same blocking
   > condition has repeated for 3 consecutive goal turns."
   — `tool/goal.ts:103-107`
2. Continuation prompt injected into the loop:
   > "Call update_goal with status \"complete\" only after current evidence
   > proves every requirement is satisfied. Call update_goal with status
   > \"blocked\" only when the same blocker has repeated for 3 consecutive
   > goal turns."
   — `goal.ts:175` (inside `continuationPrompt`, `goal.ts:163-178`)
   (Same wording in `budgetLimitPrompt`/`iterationLimitPrompt` at 192, 208.)
3. The native `/goal` command template:
   > "Use `update_goal` with `complete` only after the goal is verified, and
   > with `blocked` only under the repeated-blocker rule."
   — `command/template/goal.txt:10`, reinforced by the Mission section
   (`goal.txt:16`), Operating Loop verification rule (`goal.txt:24-31`), and
   "What Counts as Verification" tiers (`goal.txt:54-63`).

The **loop enforcement** (when the goal keeps running) lives in
`nextGoalPrompt` (`prompt.ts:230-262`): after a clean model finish, if
`isGoalContinueNeeded` is true it increments the iteration and injects a
synthetic user message carrying `continuationPrompt` (or the budget/iteration
limit prompt) to keep the agent working. It stops only when the goal status
leaves `{active, budget_limited}` — i.e. when the model calls `update_goal`
with `complete`/`blocked`, or the goal is paused/usage-limited.

## 3. Event bus — `bus/`

- `Bus` namespace wraps an Effect service backed by a per-instance
  `Map<string, Subscription[]>` of subscriptions. It supports `publish`,
  `subscribe`, `once`, `subscribeAll`. Publishing fans out to exact-type and
  `"*"` subscribers, emits on `GlobalBus`, and self-activates `IslandBridge`.
  — `bus/index.ts:30-224` (publish 173-187, subscribe 189-199, once 201-214)
- `Bus.InstanceDisposed` (`server.instance.disposed`) is published on instance
  teardown to `*` subscribers. — `bus/index.ts:34-39`
- `BusEvent.schema(type, Struct)` registers Effect-Schema-flavored events and
  derives a zod payload; `BusEvent.define` is the legacy zod path.
  — `bus/bus-event.ts:43-96`
- Event **visibility** (`public`/`internal`) controls whether an event reaches
  the public SSE feed; internal events still reach in-process subscribers.
  — `bus/bus-event.ts:10-39, 58-70`
- `BusEvent.encode` projects payloads onto their declared wire shape before
  they leave the process; `BusEvent.schemas()` builds the Effect-Schema union
  of all public events for the OpenAPI/PublicApi contract.
  — `bus/bus-event.ts:98-230`
- `bus/all-events.ts` imports every module that registers a bus event (for side
  effects only) so the contract's event union is complete — it imports
  `@/session/goal`, `@/session/index`, `@/session/message-v2`,
  `@/delegation/manager`, `@/loop/engine`, etc. — `all-events.ts:1-41`

Events relevant to sessions/goals:

- `session.created`, `session.updated`, `session.deleted`, `session.error`,
  `session.pending.promoted`, `session.instructions.updated` — `session/index.ts:260-308`
- `session.goal` (goal create/update/clear) — `goal.ts:37-46`
- `message.updated`, `message.removed`, `message.part.updated`,
  `message.part.removed` — `message-v2.ts:558-587`
- `delegation.completed` — `delegation/manager.ts:16-24`

## 4. Delegation / background tasks

Layers: `tool/task.ts` (the `task` tool + background orchestration),
`delegation/manager.ts` (in-memory manager + bus event), `background/run.ts`
(durable records + parent-wake prompt), `background/repo.ts` (SQL).

### 4.1 Durable record + repo — `background/run.ts`, `background/repo.ts`

- `BackgroundRun.RecordSchema` — id, sessionID, parentSessionID, agent,
  parentAgent, prompt, status, createdAt/updatedAt/completedAt, artifactPath,
  title, workspaceID, sandbox, source (`task | model-subtask | advisor |
  research | ultrareview | delegator | delegator-followup | loop | other`),
  role (`worker | delegator | followup | advisor | other`), result/progress
  summaries, error, metadata, owner/lease fields (`ownerID`, `ownerPID`,
  `heartbeatAt`), delegator link fields, and job-tree fields (`jobID`,
  `rootDelegationID`, `parentDelegationID`). — `background/run.ts:22-80`
- `LEASE_TIMEOUT_MS = 15_000`; `touchLease` refreshes `heartbeatAt`.
  — `background/run.ts:19, 358-366`
- `create` persists via `BackgroundRunRepo.upsert`. — `background/run.ts:282-339`
- `finalize` flips status, sets summaries, writes the markdown artifact.
  — `background/run.ts:468-487`
- `finalizeFromSession` (489-509) and `markOrphaned` (511-521) and
  `reconcileInterrupted` (529-544) recover runs whose owner died (lease expiry).
- `buildParentWakePromptInput` builds the `SessionPrompt.PromptInput` text that
  wakes the parent session. — `background/run.ts:198-239`

`BackgroundRunRepo` is the SQL repo (table `background_run`), keyed by
`(projectId, id)`, with `get/upsert/update/list/listRunning/listForParent`.
— `background/repo.ts:12-121`

### 4.2 Manager + completion event — `delegation/manager.ts`

- `DelegationCompletedEvent = "delegation.completed"` with
  `{ delegationID, parentSessionID, status, title }`. — `delegation/manager.ts:16-24`
- `Delegation.Status` enum. — `delegation/manager.ts:37`
- `create` makes a durable `BackgroundRun`, starts a timeout timer and a lease
  heartbeat. — `delegation/manager.ts:435-463`
- `finalize` writes the durable record, cleans up in-memory state, then
  publishes `DelegationCompletedEvent`. — `delegation/manager.ts:513-550`
- `waitForSettled` / `waitForSettledJob` subscribe to `DelegationCompletedEvent`
  and `Bus.InstanceDisposed` and resolve once no running non-delegator
  records remain. — `delegation/manager.ts:766-861`
- Cancel/timeout paths: `cancel` (688-711), `cancelJob` (713-721),
  `setTimer`/`scheduleForcedFinalize` (380-419).

### 4.3 The `task` tool + background launch — `tool/task.ts`

- `task` parameters default `background: true`. — `tool/task.ts:36-39`
- `runBackgroundDelegation` runs a worker session via
  `SessionPrompt.prompt(...)`, then summarizes and `Delegation.finalize`s the
  worker record. — `tool/task.ts:497-547`
- `subscribeDelegationProgress` subscribes to `message.part.updated` to
  throttle-write progress summaries. — `tool/task.ts:549-577`
- `launchBackgroundSubtask` creates a worker `Delegation` and a supervising
  **delegator** `Delegation` (a separate `@delegator` session), runs the
  worker, then loops up to 3 times: waits for the job to settle, collects
  results, runs the delegator to synthesize/spawn follow-ups, finally finalizes
  the delegator and **wakes the parent session**. — `tool/task.ts:632-880`
- `wakeParentSession` is how completion wakes the parent: it calls
  `SessionPrompt.prompt({ sessionID: parentSessionID, parts: [text summary] })`
  with the "Background task finished…" summary and a `delegation(action="read")`
  hint. — `tool/task.ts:579-630`

The agent-loop side of background subtasks: when the model emits a
`SubtaskPart` (background `task` tool), `runLoop` creates the assistant/tool
parts and executes `TaskTool.executeAsync` with `background: true` — the parent
turn is not blocked on completion; the wake comes later via
`wakeParentSession`. — `prompt.ts:798-1011`

## 5. Brain / memory pass — `brain/`

- Config + thresholds: `minHours` (24), `minSessions` (5), `enabled`,
  `memoryEnabled`, optional `brainModel`. — `brain/index.ts:90-103`
- Two output files, kept strictly separate:
  - **Project memory** — `.github/instructions/memory.instruction.md`
    (what is true about the codebase). — `brain/index.ts:112-114, 203-217`
  - **User habits** — `Profile.habitsFile(...)` (`.nikcli/habits.md`), what the
    *person* repeats (workflows, tools, corrections). — `brain/index.ts:125-142`
- `Brain.shouldTrigger` gates on enabled/memory-enabled, `minHours` since last
  run, a 10-min scan throttle, and `minSessions` new sessions.
  — `brain/index.ts:268-303`
- `Brain.trigger` dedupes concurrent runs and calls `runBrain`, which acquires a
  `Flock` lease (1h), collects session IDs since the last run, runs
  `executeBrain`, and only records success if either memory file actually
  changed. — `brain/index.ts:305-422`
- `executeBrain` creates a locked-down Brain session (read/edit/glob/grep/list
  allowed; task/todo denied), resolves the brain model
  (`getBrainProviderModel`), builds the consolidation prompt, and runs
  `SessionPrompt.prompt` with a 5-minute timeout. — `brain/index.ts:424-518`
- `buildBrainPrompt` is a phased prompt: orient → gather → consolidate project
  memory → consolidate user habits → prune/index. It explicitly separates code
  facts from user preferences. — `brain/index.ts:520-612`
- `buildSessionReviews` formats up to 10 recent sessions' messages (user/assistant
  text, tool status, agent, subtask, compaction) into a truncated transcript for
  the prompt. — `brain/index.ts:620-679`
- Scheduling: `initBrainScheduler` registers a 1-hour instance-scoped
  `Scheduler` job that checks `shouldTrigger` then runs `trigger`.
  — `brain/scheduler.ts:7-32`

The habits/profile file it maintains is exactly the `user_habits`/`user_profile`
content read by every session's agents (see the `## User habits` header it
writes at `brain/index.ts:131-138`).

## 6. Agent loop entry — `session/prompt.ts` `runLoop`

`runLoop(sessionID, controller)` is the turn engine. — `prompt.ts:661-1325`

- Marks the session busy (`setStatus({type:"busy"})`) at the top of each step.
  — `prompt.ts:676`
- Loads the compacted message stream and scans backward for `lastUser`,
  `lastAssistant`, `lastFinished`, and collects `compaction`/`subtask` boundary
  tasks. — `prompt.ts:680-697`
- **Turn boundary / exit detection** — `turnFinished` is true when the last
  assistant has a real `finish` (not `tool-calls`/`unknown`) whose `parentID`
  matches the last user message; on finish it checks for newly-arrived/queued
  messages and otherwise breaks. — `prompt.ts:714-784`
- **Boundary tasks** — if the next task is a `subtask`, it executes the `task`
  tool inline (`background: true`) rather than calling the model
  (`prompt.ts:798-1011`); if it is a `compaction`, it runs
  `SessionCompaction.process` (`prompt.ts:1013-1028`).
- **Step** — builds the assistant message, resolves tools
  (`resolveTools`), injects the `StructuredOutput` tool for JSON-schema mode,
  assembles the system prompt via `InstructionSync.assemble`, converts messages
  with `MessageV2.toModelMessages`, and calls
  `processor.process({...})`. — `prompt.ts:1030-1168`
- **Goal accounting** — `accountGoalTurn(sessionID, processor.message)`
  records tokens + elapsed seconds into the goal. — `prompt.ts:1170` (def at
  217-228)
- **Goal continuation** — after a clean finish, `nextGoalPrompt` may inject a
  synthetic user message to keep the loop running (see §2.5). — `prompt.ts:1227-1261`
- **Structured output** — JSON-schema mode captures output or retries.
  — `prompt.ts:1172-1225`
- **Compaction/stop** — `result === "compact"` triggers auto-compaction;
  `"stop"` breaks. — `prompt.ts:1263-1277`

**Abort handling:**

- `isUserInitiatedStop` recognizes `AbortedError` / `AbortError` /
  `RunnerCancelled` as user stops. — `prompt.ts:62-68`
- The loop checks `abort.aborted` at the top (`prompt.ts:678`) and the stream
  processor calls `input.abort.throwIfAborted()` per chunk
  (`processor.ts:287`). When the loop exits with the abort signal set, it walks
  the stream and marks the most recent assistant message with
  `MessageAbortedError` ("Interrupted by user") so the UI shows "· interrupted".
  — `prompt.ts:1286-1305`

**Ask / approve:**

- Permission asks flow through `PermissionNext.Service.ask` (via the `ask`
  helpers in `prompt.ts:70-80` and `processor.ts:52-62`). The subtask path
  merges agent + session permission rules before asking
  (`prompt.ts:913-919`), and `detectDoomLoop` (3 identical tool calls in a row)
  escalates to an `ask` with permission `doom_loop`. — `processor.ts:127-157`

## Key file map

| Concern | File | Notes |
| --- | --- | --- |
| Session record/CRUD | `src/session/index.ts` | InfoSchema 123-186, create 444-503, remove 549-649 |
| Message/part model | `src/session/message-v2.ts` | PartSchema 483-498, WithPartsSchema 589-594, toModelMessages 694-942 |
| Agent loop | `src/session/prompt.ts` | runLoop 661-1325 |
| Provider stream → parts | `src/session/processor.ts` | process 253+, LLM.stream 284 |
| Goal service/schema | `src/session/goal.ts` | whole file |
| Goal persistence | `src/session/goal-repo.ts`, `src/session/goal.sql.ts` | SQL |
| Goal tools | `src/tool/goal.ts` | create/get/update |
| Goal command | `src/command/index.ts:8,68,150-158`, `src/command/template/goal.txt` | `/goal` |
| Event bus | `src/bus/index.ts`, `src/bus/bus-event.ts`, `src/bus/all-events.ts` | |
| Delegation manager | `src/delegation/manager.ts` | delegation.completed 16-24 |
| Background run | `src/background/run.ts`, `src/background/repo.ts` | RecordSchema 44-78 |
| Task tool / background | `src/tool/task.ts` | wakeParentSession 579-630, launch 632-880 |
| Brain / memory | `src/brain/index.ts`, `src/brain/scheduler.ts` | |
