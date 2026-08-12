# User profile & learned habits

Per-user personalization for nikcli: what the user _tells_ us about themselves
(`/profile`) and what nikcli _learns_ about them by watching sessions
(`.nikcli/habits.md`). Both end up as a small standing block in the system prompt
of every agent, primary and subagent alike.

## Why two halves

|              | Declared                                        | Learned                                    |
| ------------ | ----------------------------------------------- | ------------------------------------------ |
| Source       | the user, in the `/profile` dialog              | the Brain consolidation pass               |
| Storage      | `<config>/profile/<accountID>.json`             | `<project>/.nikcli/habits.md`              |
| Scope        | the person, across every project on the machine | the person _in this project_               |
| Prompt block | `<user_profile>`                                | `<user_habits>`                            |
| Authority    | stated preference                               | inferred prior, droppable on contradiction |

Keeping them apart is the whole design. A declared preference is something the
user is accountable for; a learned habit is a guess a model made from
transcripts, and the prompt says so explicitly so an agent never argues with the
user by citing it.

## Storage

### Declared profile — `<config>/profile/<key>.json`

`key` is the active account id (`Account.active()`), or `local` when signed out.
Two people sharing a machine, or one person with a work and a personal account,
never inherit each other's settings.

Signing in **adopts** `local.json` once, on first read under the new key:
personalization done before login belongs to whoever then logs in — there is no
one else it could belong to.

This is deliberately not `nikcli.json` config: config is project-mergeable and
travels through a repo, while a profile follows the human.

Shape (`Profile.Info`, all fields optional except bookkeeping):

```jsonc
{
  "version": 1,
  "key": "acc_…", // or "local"
  "name": "Nik",
  "role": "senior backend engineer",
  "about": "builds CLIs and TUIs, ships small and often",
  "stack": ["bun", "solid", "effect"],
  "expertise": ["distributed systems"], // skip the basics here
  "learning": ["rust"], // explain more here
  "skills": ["effect", "opentui"], // reach for these first
  "tools": { "preferred": ["monitor"], "avoid": ["bash"] },
  "conventions": ["always bun, never npm"],
  "communication": { "verbosity": "concise", "explain": false, "language": "Italian" },
  "custom": "free text appended verbatim",
  "habits": true, // false = hide the learned half from agents
  "updatedAt": 1765000000000,
}
```

Reads are cached for 5s. Writes invalidate directly; the TTL only exists so a
remote server or the desktop app editing the file is picked up quickly. A
malformed file is logged and ignored — it must never take a session down.

### Learned habits — `<project>/.nikcli/habits.md`

Plain markdown, project-local, sitting next to `.nikcli/agent`, `.nikcli/command`
and friends. Being a normal file in the repo is the point: the user can read it,
edit it, commit it for the team, or gitignore it. Capped at 4 000 characters when
rendered into the prompt.

## Injection

One funnel: `SessionPrompt.systemPromptParts()` (`src/session/prompt.ts`), which
every session goes through — primary agents and task-tool subagents both.

```
system = [...environment, ...custom (AGENTS.md &c), ...profile]
```

The profile goes **last** and the block says outright that it never overrides
project instructions or the current request. Ordering plus wording, because
either alone is easy for a model to misread.

`SystemPrompt.profile()` resolves the project root from `InstanceState` before
calling `Profile.reminder(root)` — the habits half is project-local, so it cannot
be read without knowing which project we are in.

`Profile.projectRoot({ directory, worktree })` is that resolution, and every
reader shares it: the worktree when there is one (so every directory in a repo
sees one habits file), the working directory when the worktree has degraded to
the filesystem root because we are not in a repository. The Brain writer and the
`/profile` dialog call the same helper — a mismatch here would have Brain writing
a file no session ever reads.

`/usage` (context breakdown) lists the block as its own `system:profile` source,
so its token cost is visible rather than hidden inside "System prompt".

## Learning loop

The Brain pass (`src/brain/index.ts`) already consolidates recent sessions into
`.github/instructions/memory.instruction.md`. It now maintains a second file in
the same pass:

- **Phase 3** — project memory: what is true about this codebase.
- **Phase 3b** — user habits: how the person working on it works.

The prompt tells the model to keep them strictly separate, and constrains the
habits file hard: one imperative line per habit, only patterns seen **more than
once** or stated outright, never secrets or task-specific detail, rewrite over
duplicating, delete on contradiction, and leave the file untouched when a pass
finds nothing durable. An empty pass is a correct outcome.

`ensureHabitsFile()` seeds the file with a header before the session starts —
asking a model to create a file in a directory that may not exist yet is the step
that fails. A pass now counts as successful if _either_ file changed.

Triggering is unchanged: `experimental.brain`, `brainMinHours` (24),
`brainMinSessions` (5), `experimental.memory` to switch memory off entirely.

## TUI

`/profile` (aliases `/me`, `/personalize`), also in the command palette under
Account. `src/cli/cmd/tui/component/dialog-profile.tsx`.

- **About you** — name, role, about, stack, knows-well, learning
- **Preferences** — preferred skills (from the server's skill catalog), preferred
  and avoided tools (from `/experimental/tool/ids`), conventions
- **Communication** — answer length, explain reasoning, reply language, extra notes
- **Learned habits** — toggle visibility, review the file, forget it
- **Actions** — _Preview what agents receive_ (the literal rendered blocks), reset

The dialog calls the `Profile` service in-process, like the account sign-in
dialog beside it; only the skill and tool catalogs go through the SDK, because
those are the server's to answer. Text fields take `-` to clear, since the prompt
component swallows an empty submit.

## Not done yet

- **HTTP routes + SDK.** The profile is read and written in-process, so a session
  driven against a _remote_ nikcli server reads that machine's profile, not the
  local one. Desktop and mobile parity needs `GET/PATCH/DELETE /profile` plus a
  codegen run.
- **Preferred skills are advisory.** They are named in the prompt; they do not
  auto-load skill content into the session (that costs real tokens per skill).
  Auto-load would be an opt-in per skill.
- **Preferred/avoided tools are advisory too.** They do not filter the toolset —
  `session.disabledTools` is the mechanism that actually removes a tool, and
  wiring the profile into it would silently change what a session can do.

## Tests

- `test/profile/profile.test.ts` — storage round-trip, merge/clear semantics,
  malformed file, rendering of both blocks, truncation, opt-out, habits path.
- `test/profile/system-prompt.test.ts` — the real injection path: a saved profile
  plus a `.nikcli/habits.md` come back out of `SystemPrompt.profile()` inside an
  instance scope.
- `test/brain/brain-habits.test.ts` — the two-file prompt, its guardrails, and
  clean degradation to the project-only pass.
- `test/tui/profile-command.test.ts` — `/profile` stays registered and lazily
  resolves to the dialog (source-level, like `entry-coverage.test.ts`).

The TUI dialog itself is not render-tested: this package has no harness for
mounting a dialog with its contexts, and the OpenTUI renderer aborts under a PTY
in a headless sandbox, so `script/tui-smoke.ts` needs a real terminal.
