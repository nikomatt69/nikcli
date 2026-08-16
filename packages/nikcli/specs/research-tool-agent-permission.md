# Tool, Agent, and Permission Model — Research Notes

Scope: `src/tool/`, `src/agent/`, `src/permission/`, `src/plugin/`, `src/policy/`,
`src/skill/` (tool hooks where relevant). All paths below are relative to
`packages/nikcli` unless noted. Line numbers are approximate and refer to the
state of the tree at the time of writing.

---

## 1. Tool definition pattern

Core file: `src/tool/tool.ts`.

### Namespace and types

- `Tool.Metadata = Record<string, unknown>` (`tool.ts:20`)
- `Tool.ProgressContent` / `Tool.Progress` — structured + optional file/text
  content arrays (`tool.ts:22-34`)
- `Tool.InitContext = { agent?: Agent.Info }` (`tool.ts:38-40`)

`Tool.Context<M>` (`tool.ts:42-53`) is what every tool body receives:

| field | type | notes |
|-------|------|-------|
| `sessionID` | `string` | current session id |
| `messageID` | `string` | current assistant message id |
| `agent` | `string` | agent **name** (string, not `Agent.Info`) |
| `abort` | `AbortSignal` | cooperative cancellation |
| `callID` | `string` | tool-call id |
| `extra?` | `Record<string, unknown>` | e.g. `{ model, bypassAgentCheck }` |
| `messages?` | `MessageV2.WithParts[]` | optional message history |
| `metadata(input)` | `(input) => void` | update running tool-part title/metadata |
| `progress(input)` | `(input) => Promise<void>` | streaming structured progress |
| `ask(input)` | `(input) => Promise<void>` | permission gate (see §6) |

### Result shape

`Tool.Result<M>` (`tool.ts:55-65`):

```ts
{
  title: string
  metadata: M
  output: string            // model-facing string (post-truncation)
  value?: unknown           // schema-validated machine success (Code Mode)
  attachments?: MessageV2.FilePart[]
}
```

- `Tool.encoded(result, output?)` (`tool.ts:71-73`) — returns `result.value`
  when an `output` codec was declared, else the string `result.output`.
- Result is always `{ title, metadata, output }`; `value` is optional and only
  populated when the tool declares an `output` codec.

### Definition interfaces

- `Tool.Def` (`tool.ts:79-101`) — the **unified** shape after wrapping:
  `description`, `parameters` (zod), optional `output` (zod success codec),
  `execute(args, ctx): Effect.Effect<Result, Error>` (canonical), plus
  `executeAsync(args, ctx): Promise<Result>` (compat wrapper), and optional
  `formatValidationError`.
- `Tool.AuthoredDef` (`tool.ts:107-113`) — what authors write. `execute` may
  return **either** `Promise<Result>` **or** `Effect.Effect<Result, Error>`.
- `Tool.Info<Parameters, M>` (`tool.ts:115-118`) — the registry-facing handle:

```ts
interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string
  init: (ctx?: InitContext) => Promise<Def<Parameters, M>>
}
```

- `Tool.InferParameters` / `Tool.InferMetadata` (`tool.ts:120-121`) extract the
  zod-parameter and metadata types from an `Info`.

### `Tool.define(id, init)` — sync/async normalization (`tool.ts:141-229`)

`define` accepts either a `AuthoredDef` object or an `AuthoredInit` function
(`(initCtx) => Promise<AuthoredDef>`), and produces an `Info`. Inside:

1. **Argument validation** — `authored.parameters.parse(args)`; on `ZodError`
   either calls `formatValidationError` or fails with a standard
   "rewrite the input" message (`tool.ts:151-165`).
2. **Context wrapping** — `ctx.metadata` is wrapped so that `truncated` defaults
   to `false` when absent (`tool.ts:167-179`).
3. **Effect normalization** — `isEffect`/`asEffect` (`tool.ts:127-139`) wrap a
   `Promise` body in `Effect.tryPromise`; Effect bodies pass through unchanged
   (`tool.ts:181`).
4. **Output codec validation** — if `authored.output` is set, `result.value` is
   parsed with the codec; malformed success fails the effect
   (`tool.ts:182-195`).
5. **Truncation** — best-effort; rewrites only `output` (never `value`),
   attaches `metadata.truncated` and optionally `metadata.outputPath`
   (`tool.ts:196-215`).

The two-execution-shape story: Effect is the canonical target for new tools;
`executeAsync` is the legacy Promise path (thin `AppRuntime.runPromise`
wrapper, `tool.ts:223`). Existing tools may still return Promises and are
auto-wrapped.

### Example shapes across `src/tool/`

- Sync-returning (async function returning `{title,metadata,output}`):
  `question.ts:28-61`, `ls.ts`, `glob.ts`, `todo.ts`.
- Effect-native (`Effect.gen`): `advisor.ts`, `task.ts`, `speak.ts`.
- Declared `output` codec + `formatValidationError`: used by tools consumed in
  Code Mode (e.g. `code_mode.ts`); the `output` field is optional in the
  contract (`tool.ts:86, 110`).
- Plugin-authored tools are converted through `ToolRegistry.fromPlugin`
  (`registry.ts:247-276`).

### Registry (`src/tool/registry.ts`)

- `ToolRegistry.Service` interface (`registry.ts:174-185`):
  `register`, `ids`, `tools(model, agent?, options?)`.
- Built-in registration order in `all()` (`registry.ts:377-438`): built-ins
  first, then flag-gated tools, then contributed (config-dir + plugin) tools,
  then runtime `register()` entries; `lastWins` dedupes by id
  (`registry.ts:154-158, 383`).
- **Opt-in tools** (`registry.ts:95, 105-108`): `OPT_IN = {"opentui"}`;
  `enabled(id, disabled)` requires an explicit `false` for opt-in tools to turn
  them on.
- `visible(id, {disabledTools, ruleset})` (`registry.ts:119-133`) hides
  session-disabled tools and wholly-denied tools (pattern `*`).
- Model/flag filters in `tools()` (`registry.ts:453-474`): `codesearch`/
  `websearch` gated by provider/`NIKCLI_ENABLE_EXA`; `apply_patch` vs the
  `edit`/`write`/`multiedit` family are mutually exclusive by model; `advisor`
  only when the agent has an `advisor` model.

---

## 2. Agents (`src/agent/agent.ts`)

### Schema

`Agent.Info` (`agent.ts:73-98`): `name`, `mode` (`"subagent" | "primary" |
"all"`), `description?`, `native?`, `hidden?`, `temperature?`, `topP?`,
`color?`, `permission` (mutable array of `PermissionNext.Rule`), `model?`,
`advisor?`, `variant?`, `prompt?`, `options`, `steps?`, `order?`.

### Defaults ruleset (base for every agent) (`agent.ts:156-175`)

Built via `PermissionNext.fromConfig`:

```ts
{ "*": "allow", browser_control: "ask", computer: "ask", doom_loop: "ask",
  external_directory: { "*": "ask", <Truncate.DIR>: "allow", <Truncate.GLOB>: "allow" },
  question: "deny", plan_enter: "deny", plan_exit: "deny",
  read: { "*": "allow", "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" } }
```

Each agent merges `defaults` + agent-specific overrides + user config
(`PermissionNext.merge(defaults, override, user)`, where `user` comes from
`cfg.permission`).

### Primary agents (`mode: "primary"`)

| name | role / notes | permission deltas vs defaults |
|------|--------------|-------------------------------|
| `ralph` (`agent.ts:179-197`) | Autonomous loop agent; iterates until done. | `question: allow` |
| `build` (`agent.ts:198-215`) | Build/feature agent. Adds monitor-tool awareness. | `question: allow`, `plan_enter: allow` |
| `plan` (`agent.ts:216-241`) | Planning agent. | `question: allow`, `plan_exit: allow`, `edit: deny` except `.nikcli/plans/*.md` and data/plans; allows data `plans/*` external dir |
| `compaction` (`agent.ts:606-620`) | Hidden internal compaction pass. | `*: deny` |
| `title` (`agent.ts:621-636`) | Hidden title-generation pass (`temperature: 0.5`). | `*: deny` |
| `summary` (`agent.ts:734-748`) | Hidden summary-generation pass. | `*: deny` |

### Subagents (`mode: "subagent"`)

| name | role / notes | permission deltas |
|------|--------------|-------------------|
| `scout` (`agent.ts:343-377`) | Read-only research of external libs/repos. Gated by `NIKCLI_EXPERIMENTAL_SCOUT` (default on). | `*: deny`; read/grep/glob/list/tree/webfetch/websearch/codesearch/repo_clone/repo_overview allow; external `repos/*` allow |
| `researcher` (`agent.ts:378-444`) | Hidden read-only background evidence collector. | `*: deny`; read/grep/glob/list/tree/websearch/webfetch/memory_search/context_collect/context_related/delegation/delegator allow; `task` allow only for `fast-explore`/`planner` (researcher denied) |
| `ultrareview-reviewer` (`agent.ts:472-500`) | Hidden single-domain reviewer in ultrareview fleet. | `*: deny`; read/grep/glob/list/bash allow |
| `delegator` (`agent.ts:584-605`) | Hidden coordination agent synthesising background results. | `*: deny`; `task: allow` (required by DelegationTool's `ctx.ask({permission:"task"})`), read allow |

### `mode: "all"` (usable as both primary and subagent)

| name | role / notes | permission deltas |
|------|--------------|-------------------|
| `general` (`agent.ts:242-256`) | General-purpose parallel agent. | `todoread: deny`, `todowrite: deny` |
| `explore` (`agent.ts:257-283`) | Fast codebase explorer. | `*: deny`; read/grep/glob/list/bash/webfetch/websearch/codesearch allow |
| `fast-explore` (`agent.ts:284-311`) | Read-only quick inspector. | `*: deny`; read/grep/glob/list/tree allow |
| `planner` (`agent.ts:312-342`) | Planning subagent (read-only). | `*: deny`; read/grep/glob/list/tree/webfetch/websearch/codesearch allow |
| `code-reviewer` (`agent.ts:445-471`) | Code review. | `*: deny`; read/grep/glob/list/bash allow |
| `debugger` (`agent.ts:501-528`) | Debug failures, minimal fixes. | `*: deny`; read/grep/glob/list/bash/edit allow |
| `test-runner` (`agent.ts:529-555`) | Run/analyze tests. | `*: deny`; read/grep/list/bash/edit allow |
| `refactor` (`agent.ts:556-583`) | Safe refactors. | `*: deny`; read/grep/glob/list/bash/edit allow |
| `support` (`agent.ts:637-733`) | Hidden docs/help assistant (invoked from `/support`). | `*: deny`; read-only `bash` allowlist (see below) |

The `support` agent's `bash` permission is a read-only allowlist of literal
patterns (`nikcli --version`, `nikcli doctor *`, `cat *`, `ls *`, `find *`,
etc.) ending in `"*": "deny"` (`agent.ts:700-724`).

### `SUBAGENT_TOOLSETS` (`agent.ts:101-137`)

A canonical `Record<string, string[]>` of allowed tool ids per subagent
(`fast-explore`, `planner`, `scout`, `general`, `explore`, `researcher`,
`code-reviewer`, `debugger`, `test-runner`, `refactor`). It is exported and
referenced by tests (`test/agent/schema.test.ts`,
`test/tool/permission-surface.test.ts`); it is the declared toolset surface,
not a runtime enforcement point.

### Dynamic agent construction

- `buildState(worktree, cfg)` (`agent.ts:155-884`) returns the full map.
- Reference agents (`reference-*`) are derived from `cfg.reference` under the
  scout flag (`agent.ts:751-822`).
- Config-driven agents from `cfg.agent` (`agent.ts:824-861`): `disable` removes
  them; unknown keys become new `mode:"all"` agents; `model`, `advisor`,
  `permission`, `prompt`, `mode`, `temperature`, `steps`, `order`, etc. are
  merged over the defaults.
- Post-pass (`agent.ts:863-881`): any agent without an explicit
  `external_directory` deny for `Truncate.DIR`/`Truncate.GLOB` gets those two
  allow rules appended.
- Default agent selection (`agent.ts:925-952`): `cfg.default_agent` if set
  (and not subagent/hidden), else the first visible non-subagent non-hidden
  agent (which sorts `build` first by default).

---

## 3. Permission model

### Schemas

- `src/permission/schema.ts` — `Action` (`ask|allow|deny`), `Rule`
  `{ permission, pattern, action }`, `Ruleset` (array). (`schema.ts:5-19`)
- `src/permission/ruleset.ts` re-defines the same pure model with Effect
  `Schema` + zod wrappers: `ActionSchema`, `RuleSchema`, `RulesetSchema`
  (`ruleset.ts:22-40`). This module is deliberately dependency-light so light
  clients (truncation, TUI) can evaluate rules without the stateful permission
  service (`ruleset.ts:8-10`).

### Pure evaluator (`ruleset.ts`)

- `expand(pattern)` (`ruleset.ts:14-20`) — expands `~`, `~/…`, `$HOME`, `$HOME/…`.
- `fromConfig(permission)` (`ruleset.ts:42-62`) — string value → `pattern:"*"`;
  object value → per-pattern rules.
- `merge(...rulesets)` (`ruleset.ts:64-66`) — flat concat.
- `fullAccess()` (`ruleset.ts:82-89`) — `* allow` + deny `question`,
  `plan_enter`, `plan_exit` (denials must follow the blanket allow because
  evaluate takes the **last** match).
- `autoApprove(...rulesets)` (`ruleset.ts:102-109`) — blanket `* allow` with
  surviving `deny` rules appended (denials win).
- `evaluate(permission, pattern, ...rulesets)` (`ruleset.ts:111-120`) — finds
  the **last** matching rule via `Wildcard.match` on both permission and
  pattern; default is `{ action: "ask", pattern: "*" }`.

### `TOOL_PERMISSION` coupling map (`ruleset.ts:136-149`)

```ts
export const TOOL_PERMISSION: Record<string, string> = {
  monitor: "bash",       // monitor shares the bash permission
  edit: "edit",
  write: "edit",
  patch: "edit",
  multiedit: "edit",
  apply_patch: "edit",   // edit-family collapses to `edit`
}
```

Semantics: a tool id in this map is evaluated against the **mapped**
permission string instead of its own id. So `monitor → bash` (denying `bash`
denies `monitor`), and the whole edit family (`edit`, `write`, `patch`,
`multiedit`, `apply_patch`) → `edit`. Tools not listed evaluate against their
own id (`ruleset.ts:126-134`). `disabled(tools, ruleset)`
(`ruleset.ts:151-161`) uses this map to compute which tools are wholly denied
(pattern `*` + action `deny`).

### Runtime evaluation and deny semantics

- **Effective ruleset** built once per tool resolution in
  `src/session/tools.ts` `resolveTools` (`tools.ts:216-221`):
  `merge(agent.permission, session.permission)`, then `autoApprove` if
  `Flag.autoApprove()` (i.e. `NIKCLI_AUTO_APPROVE`).
- `ToolRegistry.visible` (`registry.ts:119-133`) drops wholly-denied tools from
  the model's schema (pattern `"*"` + `deny`); resource-scoped denies keep the
  tool visible (it still works on allowed paths).
- Each tool body calls `ctx.ask({ permission, patterns, always, metadata })`.
  The concrete `ctx.ask` implementation (`tools.ts:258-268`) injects
  `sessionID`, `tool.{messageID,callID}`, and the computed `ruleset`, then
  calls `PermissionNext.ask`.

### `PermissionNext` service (`src/permission/next.ts`)

- `Request` schema (`next.ts:37-52`): `id` (`per*`), `sessionID` (`ses*`),
  `permission`, `patterns[]`, `metadata`, `always[]`, optional
  `tool.{messageID,callID}`.
- `Reply` = `"once" | "always" | "reject"` (`next.ts:54-56`).
- `AskInput = Request.partial({id}).extend({ ruleset })` (`next.ts:88-91`).
- `ask(input)` (`next.ts:125-172`): for each `pattern`, calls `evaluate`. The
  flow is:
  - `deny` → fail with `DeniedError` (message includes the relevant rules).
  - `ask` → unless `NIKCLI_DANGEROUSLY_SKIP_PERMISSIONS` (which auto-approves
    `ask` rules after the deny check), register a `PendingEntry`, publish
    `Event.Asked`, and wait via `Effect.callback`.
  - `allow` → continue.
- `reply(input)` (`next.ts:174-241`): `once` resolves; `always` appends an
  `allow` rule per `always` pattern, persists via `PermissionRepo.upsert`, and
  auto-resolves other pending asks in the same session whose patterns now
  evaluate to `allow`; `reject` fails the ask (and rejects all other pending
  asks for the session).
- `hydrateAsk` / `hydrateReply` / `list` (`next.ts:243-260`) — pending-request
  bookkeeping (used by the HTTP/TUI layer).
- Error classes (`next.ts:277-297`): `RejectedError`, `CorrectedError`
  (with user feedback), `DeniedError`.

### Persistence

`src/permission/permission-repo.ts` + `permission.sql.ts`: approved rulesets
persisted per project in SQLite table `permission_ruleset` (`projectId` PK,
`rules` JSON). `get`/`upsert`/`remove` are synchronous over `Database.syncDb()`.

### Bash arity and shell splitting

- `src/permission/arity.ts` — `BashArity.prefix(tokens)` maps a command's first
  token(s) to a known argument "arity" so the permission pattern captures the
  command prefix (e.g. `git config` → 3 tokens, `npm run` → 3). Large table at
  `arity.ts:12-164`.
- `src/permission/shell-split.ts` — `splitShellStatements(input)` is a
  quote-aware splitter producing independent commands so each is
  permission-checked separately (`git status && rm -rf build` → two commands);
  conservative by design (`shell-split.ts:1-11`).

### `src/policy/policy.ts`

A separate, simpler allow/deny policy engine for **providers** (not tools):
`Statement { effect: "allow"|"deny", action, resource }`, glob-suffix matching
(`policy.ts:17-21`), `legacyProviderStatements` for `enabled_providers` /
`disabled_providers` (`policy.ts:23-47`), `allows` (`policy.ts:53-61`),
`allowsProvider` and `filter` (`policy.ts:63-83`). Tool permissions do **not**
flow through this module.

---

## 4. Plugin system

### `Plugin.Service` (`src/plugin/index.ts:662-941`)

Interface (`index.ts:667-679`): `trigger(name, input, output)`, `list()`,
`init()`. `trigger` excludes `auth|dispose|event|tool|provider` (those are
handled specially — `tool`/`provider`/`auth` are surfaced through the registry/
provider layer, `event` through `Bus`).

Hook types come from `@nikcli-ai/plugin` (`packages/plugin/src/index.ts`,
`Hooks` interface at `182-301`):

- `dispose`, `event`, `config`
- `tool?: { [key: string]: ToolDefinition }` — plugin-contributed tools
- `auth?: AuthHook`, `provider?: { id, models(...) }`
- `"chat.message"`, `"chat.params"`, `"chat.headers"`, `"chat.request"`
- `"permission.ask"` — can mutate `output.status` (`ask|deny|allow`)
- `"shell.env"`, `"shell.create.before"`, `"command.execute.before"`
- `"tool.execute.before"` / `"tool.execute.after"`
- `"experimental.chat.messages.transform"`,
  `"experimental.chat.system.transform"`,
  `"experimental.session.compacting"`, `"experimental.text.complete"`

`triggerHooks` (`index.ts:829-856`) runs each hook with per-hook try/catch so
one plugin's failure does not block others.

### Plugin loading (`index.ts:712-819`)

`buildState` creates the in-process SDK client, builds `PluginInput`
(`{ client, project, worktree, directory, serverUrl, $ }`), loads internal
plugins (`CodexAuthPlugin`, `CopilotAuthPlugin`, `XAIAuthPlugin`,
`CursorAuthPlugin`, Cloudflare, `HerdrPlugin`, `NotifyPlugin`), then loads
`config.plugin` entries (npm package install via `BunProc.install`, or
`file://` import), reading v1 `PluginModule.server` or named/default exports.

### Plugin tool shape (`packages/plugin/src/tool.ts`)

```ts
tool({ description, args /* z.ZodRawShape */,
       execute(args, ctx) => Promise<ToolResult> })
```

`ToolResult = string | { title?, output, metadata?, attachments? }`;
`ToolContext` mirrors the core `Tool.Context` (sessionID/messageID/callID/agent/
abort/metadata/progress/ask) (`tool.ts:3-44`). `ToolDefinition` is the return
of `tool()` (`tool.ts:55`). The registry converts these via
`ToolRegistry.fromPlugin` (`registry.ts:247-276`), attaching file
`attachments` mapped to `MessageV2.FilePart`.

### Config-dir `{tool,tools}/*.{js,ts}` autoload — where enforced

Enforced in `src/tool/registry.ts` `layer` (derived state), `registry.ts:278-358`:

1. `glob = new Bun.Glob("{tool,tools}/*.{js,ts}")` (`registry.ts:284`).
2. Read config: `allowlist = config.tool?.allow ?? []`,
   `pins = config.tool?.pin ?? {}` (`registry.ts:287-288`).
3. `autoloadEnabled = Flag.NIKCLI_ALLOW_PLUGIN_AUTOLOAD || allowlist.length > 0`
   (`registry.ts:289`) — **autoload is off by default**; it runs only with the
   env flag or a non-empty `tool.allow`.
4. When enabled, scan each config directory (`configDirectories(ctx)`), skip
   missing dirs, and iterate matches (`registry.ts:296-308`).
5. **Allowlist filter** (`registry.ts:312-317`): if `allowlist` is non-empty,
   a file is skipped unless `isToolPathAllowed` matches by absolute path,
   basename, or extension-less name (`registry.ts:215-219`).
6. **sha256 pinning** (`registry.ts:318-329`): `expectedHash =
   pins[match] ?? pins[base] ?? pins[namespace]`; if set, the file is hashed
   (`sha256File`, `registry.ts:221-225`) and a mismatch logs an error and
   **refuses to load** the file.
7. `import(match)` then `Object.entries<ToolDefinition>(mod)` →
   `fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def)`
   (`registry.ts:331-334`).

Test/docs seams: `shouldScanCustomTools` and `isCustomToolAllowed`
(`registry.ts:227-235`).

### Config schema (`src/config/config.ts:1651-1667`)

`tool` is distinct from the deprecated `tools` (enable/disable registered ids,
`config.ts:1645`). Schema:

```ts
tool: {
  allow?: string[]   // basenames or absolute paths; loads even without the env flag
  pin?: Record<string, string> // basename/path → sha256 hex
}
```

### Flag (`@nikcli-ai/util/flag`)

`NIKCLI_ALLOW_PLUGIN_AUTOLOAD` is a dynamic getter over
`truthy("NIKCLI_ALLOW_PLUGIN_AUTOLOAD")` (`flag.ts:224-230`), documented as a
security boundary (`flag.ts:167-172`). `Flag.autoApprove()` reads
`NIKCLI_AUTO_APPROVE` on every access (`flag.ts:14-16`).

---

## 5. Skill system (`src/skill/skill.ts`)

- `Skill.Info` schema (`skill.ts:26-38`): `name`, `description`, `location`,
  optional `category`, `tags`, `version`. `Skill.Loaded = Info & { dir,
  content }` (`skill.ts:39-42`).
- Errors (`skill.ts:44-79`): `InvalidError`, `NameMismatchError`,
  `NotFoundError`, `AlreadyExistsError`, plus `ConfigMarkdown.FrontmatterError`
  in the `Skill.Error` union.
- `Skill.Service` interface (`skill.ts:122-132`): `get`, `all`, `resolve`,
  `load`, `create`, `remove`.

### Loading / discovery (`skill.ts:168-263`)

- **External dirs** `.claude` and `.agents` (`skill.ts:104`), scanned at global
  home and walked up from the project (`Filesystem.up`) unless
  `NIKCLI_DISABLE_EXTERNAL_SKILLS` (`skill.ts:224-238`).
- **nikcli dirs**: config directories scanned with
  `{skill,skills}/**/SKILL.md` (`skill.ts:107, 240-256`).
- Each `SKILL.md` is parsed with `ConfigMarkdown.parse`; frontmatter → `Info`
  (`skill.ts:176-206`). Duplicate names log a warning; the map is keyed by
  `name`.
- State is a `reloadable` `InstanceState` derivation of files on disk
  (`skill.ts:260-262`).

### Operations

- `resolve(name)` (`skill.ts:273-315`) does exact → normalized → partial →
  related-name matching and returns `{ skill?, suggestions[] }`.
- `load(name)` (`skill.ts:317-330`) re-parses the file and returns content.
- `create(input)` (`skill.ts:332-384`) writes a new `SKILL.md` (frontmatter +
  body) under `.nikcli/skill/<slug>` (workspace) or global `skills/<slug>`
  (`skill.ts:345-355`).
- `remove(name)` (`skill.ts:386-399`) deletes the skill dir.

### Tool hook

The `skill` **tool** (not the service) lives in `src/tool/skill.ts` — it lets
the model list/load/invoke skills. Skill command naming
(`SKILL_COMMAND_PREFIX`, `skillCommandName`, `isSkillCommandName`) comes from
`@nikcli-ai/util/skill-command` (`skill.ts:1-6, 117-118`). `src/skill/index.ts`
just re-exports `./skill`.

---

## 6. Permission prompt / ask flow

### Wiring

1. Tool body → `ctx.ask({ permission, patterns, always, metadata })`. Examples:
   - `bash.ts:437-452` — asks `external_directory` then `bash` with
     arity-derived patterns.
   - `edit.ts:83-101, 132-148` — asks `edit` with the file path + diff metadata.
   - `read.ts:57`, `grep.ts:177`, `write.ts:75`, `webfetch.ts:31`,
     `websearch.ts:48`, `codesearch.ts:32`, `glob.ts:105`, `ls.ts:53`,
     `lsp.ts:46`, `memory_search.ts:34`, `repo_overview.ts:28/48`,
     `apply_patch.ts:187`, `generate_image.ts:227`, `browser-control.ts:159`,
     `computer.ts:86`, `skill.ts:128`, `speak.ts:336`, `voice.ts:127`,
     `todo.ts:31/61` (all call `ctx.ask`).
2. `ctx.ask` is constructed in `session/tools.ts` `context()`
   (`tools.ts:223-269`); the `ask` field (`tools.ts:258-268`) calls
   `askPermission` (`tools.ts:157-167`) → `PermissionNext.Service.ask`, passing
   the merged ruleset (agent + session, auto-approve applied).
3. `PermissionNext.ask` (`next.ts:125-172`) evaluates each pattern; `deny`
   throws `DeniedError`; `ask` publishes `Event.Asked` (`next.ts:164`) and
   parks in `Effect.callback` until a reply; `allow` proceeds.

### Reply / approval

- `PermissionNext.reply` (`next.ts:174-241`): the UI/HTTP layer sends
  `{ requestID, reply: "once"|"always"|"reject" }`. `always` persists an allow
  rule per `always` pattern (`PermissionRepo.upsert`); `reject` surfaces
  `RejectedError` / `CorrectedError`.
- `Event.Asked` / `Event.Replied` bus events (`next.ts:65-75`) — the notify
  plugin listens for `permission.asked` (`plugin/index.ts:603-616`), the TUI
  listens for the same to render the prompt.
- `--dangerously-skip-permissions` / `NIKCLI_DANGEROUSLY_SKIP_PERMISSIONS`
  (`next.ts:144-152`) auto-approves `ask` rules (deny still throws).

### Doom-loop detection

`src/session/processor.ts:126-157` — `detectDoomLoop` tracks a ring buffer; if
the last `DOOM_LOOP_THRESHOLD` calls are the same tool with deep-equal input, it
calls `askPermission({ permission: "doom_loop", patterns: [toolName], always:
[toolName], ruleset: agent.permission })`.

### Question tool (separate channel)

`src/tool/question.ts:28-61` — the `question` tool does **not** use the
permission ask; it calls `Question.Service.ask` (`question.ts:36-41`) to
surface a structured multi-question prompt to the user, returning the answers
in the tool result.

---

## Key file index

| Concern | File |
|---------|------|
| Tool define / Info / Context / Result | `src/tool/tool.ts` |
| Tool registry, autoload, plugin tools | `src/tool/registry.ts` |
| Agents + permissions | `src/agent/agent.ts` |
| Permission schema | `src/permission/schema.ts` |
| Permission pure evaluator + coupling map | `src/permission/ruleset.ts` |
| Permission service (ask/reply) | `src/permission/next.ts` |
| Permission persistence | `src/permission/permission-repo.ts`, `permission.sql.ts` |
| Bash arity / shell split | `src/permission/arity.ts`, `shell-split.ts` |
| Tool resolution + ctx.ask wiring | `src/session/tools.ts` |
| Doom-loop ask | `src/session/processor.ts` |
| Provider policy | `src/policy/policy.ts` |
| Plugin service + hooks | `src/plugin/index.ts`, `packages/plugin/src/index.ts` |
| Plugin tool shape | `packages/plugin/src/tool.ts` |
| Skill service + tool | `src/skill/skill.ts`, `src/tool/skill.ts` |
| tool.allow / tool.pin config | `src/config/config.ts:1651-1667` |
| Flags | `@nikcli-ai/util/flag` (`flag.ts`) |
