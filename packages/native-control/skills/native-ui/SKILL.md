---
name: native-ui
description: Build focused native interfaces for consequential workflows.
---

# Native surfaces

Guide decisions and active work with real operating-system controls.

---

## Decide when to use it

Use native UI when it unblocks a decision, collects required input, or keeps meaningful work visible without occupying the terminal. Prefer the terminal for routine edits, searches, successful commands, logs, and status the user can already see.

Good uses include permission prompts, migration or deploy reviews, multi-step forms, live progress, failure recovery, and verified completion. Avoid decorative dashboards, duplicate notifications, speculative status, and dialogs that do not require attention.

---

## Start a session

The native host polls nikcli's HTTP endpoint, while `native-control` keeps a named control session connected to the same URL. Run the host and session in separate terminals.

```bash
# Terminal 1
native-control host --url http://127.0.0.1:4096

# Terminal 2
native-control start release-flow --url http://127.0.0.1:4096
```

Inside this monorepo, replace `native-control` with `bun run --cwd packages/native-control control --` when the binary is not installed. Reuse one stable session name for the workflow.

---

## Follow the lifecycle

Use `open -> wait -> update/close`, and inspect state when recovering. Keep the same surface ID while its purpose remains unchanged.

```bash
native-control open release-flow --json '{"id":"review","kind":"dialog","title":"Review release","body":"Checks passed. Choose how to continue.","controls":[{"type":"button","id":"cancel","label":"Keep current version","action":"cancel-release"},{"type":"button","id":"approve","label":"Continue release","action":"approve-release"}],"dismissible":false,"modal":true,"width":"medium","layout":"stack"}'
native-control wait release-flow --surface review --event control-activated --timeout 120000
native-control snapshot release-flow
native-control close release-flow review
```

- `open` validates and creates a complete surface, replacing stale event history for the same ID.
- `wait` filters by surface and optional event type; the default timeout is 120 seconds.
- `update` replaces the complete surface document and requires the same existing ID.
- `close` removes one surface; `snapshot` returns current surfaces and captured events.
- `list` lists control sessions; `stop`, `remove`, and `close-all` clean up session state.

The nikcli `native_ui` tool exposes `open`, `update`, `wait`, `close`, and `list` directly. Its `list` operation returns active surfaces, while `update` patches supplied fields and preserves omitted fields unlike the CLI's complete-document update.

---

## Choose a surface

Pick the least disruptive kind that fits the interaction.

| Kind           | Use                                    | Important fields           |
| -------------- | -------------------------------------- | -------------------------- |
| `dialog`       | Required input or consequential review | `modal`, `width`, `layout` |
| `popover`      | Non-blocking activity or progress      | `anchor`, `placement`      |
| `menu`         | Compact actions or failure recovery    | `items`                    |
| `notification` | Brief verified outcome                 | `severity`, `durationMs`   |

Every surface requires `id`, `kind`, and `title`; `controls` defaults to an empty list and `dismissible` defaults to `true`. Optional `body` and `metadata` fields carry concise context and JSON-safe details.

Dialogs support `small`, `medium`, and `large` widths plus `stack` or `dashboard` layouts. Popovers require an anchor rectangle and support `top`, `right`, `bottom`, or `left` placement.

An empty-control notification uses the operating system's notification path. A notification with controls is presented as an interactive dialog so its actions can return events.

---

## Compose controls

Use controls to expose necessary facts, input, and actions.

| Control      | Required fields          | Use                                          |
| ------------ | ------------------------ | -------------------------------------------- |
| `button`     | `id`, `label`, `action`  | Invoke an agent-handled action               |
| `link`       | `id`, `label`, `url`     | Open a validated URL                         |
| `text-input` | `id`                     | Collect text, secure text, or multiline text |
| `select`     | `id`, `label`, `options` | Choose one option ID                         |
| `checkbox`   | `id`, `label`, `checked` | Confirm or toggle a boolean                  |
| `progress`   | `id`, `value`            | Show a fraction from `0` to `1`              |
| `metric`     | `id`, `label`, `value`   | Highlight a verified value                   |
| `section`    | `id`, `label`            | Introduce a content group                    |
| `separator`  | none                     | Separate meaningful groups                   |

Text inputs support `value`, `placeholder`, `secure`, `multiline`, and `required`. Select options, checkboxes, buttons, and links support `disabled`.

Progress supports `label`, `detail`, and `indeterminate`. Keep `value` within `0..1` even when indeterminate, and use factual detail such as `Running 54s` when no percentage exists.

Metrics support `detail`, `trend`, and `tone`; tones are `neutral`, `info`, `success`, `warning`, and `error`. Sections support a short `detail` line beneath the label.

The nikcli tool accepts at most 20 controls. Menus use protocol `items`, while the tool builds menu items from supplied button controls.

---

## Build a dashboard

Use `layout: "dashboard"` only on a large dialog that benefits from a compact operational overview. Lead with a few metrics, then use sections for supporting facts and controls for decisions.

```json
{
  "id": "release-overview",
  "kind": "dialog",
  "title": "Release overview",
  "body": "Staging | current verification run",
  "controls": [
    {
      "type": "metric",
      "id": "checks",
      "label": "Checks",
      "value": "17 / 17",
      "detail": "Current run",
      "tone": "success"
    },
    {
      "type": "metric",
      "id": "changes",
      "label": "Changed files",
      "value": "4",
      "tone": "neutral"
    },
    {
      "type": "section",
      "id": "delivery",
      "label": "Delivery",
      "detail": "Review the verified checks before continuing"
    },
    {
      "type": "button",
      "id": "close",
      "label": "Close",
      "action": "close-overview"
    }
  ],
  "dismissible": true,
  "modal": true,
  "width": "large",
  "layout": "dashboard"
}
```

The macOS renderer places metric cards before flow controls and uses up to three columns in a large window. Do not use semantic tones unless current evidence supports them.

---

## Review consequences

Present checked facts and concrete consequences, then ask only for input the agent cannot safely infer. Make cancellation explicit and keep the dialog non-dismissible when a clear choice is required.

```bash
native-control open release-flow --json '{"id":"deploy-review","kind":"dialog","title":"Review production deploy","body":"Commit a81f4c2 passed typecheck and 248 tests. Continuing applies migration 018_add_job_state.","controls":[{"type":"text-input","id":"release-note","label":"Release note","placeholder":"Describe the user-visible change","required":true},{"type":"checkbox","id":"backup-confirmed","label":"I verified the latest database backup","checked":false},{"type":"separator","id":"actions"},{"type":"button","id":"cancel","label":"Keep current production version","action":"cancel-deploy"},{"type":"button","id":"deploy","label":"Deploy api@2.4.0","action":"confirm-deploy","destructive":true}],"dismissible":false,"modal":true,"width":"large","layout":"stack"}'
native-control wait release-flow --surface deploy-review --event control-activated --timeout 120000
```

Validate required fields and safeguards from the returned action payload before acting. Treat cancellation, dismissal, timeout, and abort as a decision not to perform the consequential action.

---

## Track progress

Open one dismissible popover and update it as authoritative state changes. Keep unrelated user input unblocked and do not open a new surface for every phase.

```bash
native-control open release-flow --json '{"id":"release-progress","kind":"popover","title":"Release checks","body":"Validating the current staging candidate.","controls":[{"type":"progress","id":"build","label":"Build","value":1,"detail":"Passed in 38s"},{"type":"progress","id":"tests","label":"Tests","value":0.62,"detail":"154 of 248 passed"},{"type":"progress","id":"migration","label":"Migration dry run","value":0,"detail":"Waiting for tests"},{"type":"button","id":"cancel","label":"Cancel checks","action":"cancel-release-checks","destructive":true}],"dismissible":true,"anchor":{"x":1180,"y":44,"width":32,"height":32},"placement":"bottom"}'
native-control update release-flow --json '{"id":"release-progress","kind":"popover","title":"Release checks","body":"Build and tests passed. Verifying the migration dry run.","controls":[{"type":"progress","id":"build","label":"Build","value":1,"detail":"Passed in 38s"},{"type":"progress","id":"tests","label":"Tests","value":1,"detail":"248 passed in 2m 03s"},{"type":"progress","id":"migration","label":"Migration dry run","value":0.7,"detail":"Applying indexes"},{"type":"button","id":"cancel","label":"Cancel checks","action":"cancel-release-checks","destructive":true}],"dismissible":true,"anchor":{"x":1180,"y":44,"width":32,"height":32},"placement":"bottom"}'
```

Source percentages, durations, labels, and job IDs from current monitor, process, delegation, or command results. Use indeterminate progress rather than estimating a fraction.

An activity popover can group several meaningful jobs with separators and direct actions such as inspect, cancel, or retry. It is a useful composition, not the default interface for every task.

---

## Recover failures

Offer a short menu only after a real failure, with outcomes the agent can handle immediately. Include the failed check or stable job ID when it helps identify the context.

```bash
native-control open release-flow --json '{"id":"check-recovery","kind":"menu","title":"Typecheck failed | mon_42a1","body":"Choose a recovery action.","controls":[],"items":[{"id":"logs","label":"Inspect full log","action":"inspect-log:mon_42a1"},{"id":"retry","label":"Retry typecheck","action":"retry-monitor:mon_42a1"},{"id":"debug","label":"Start debugger agent","action":"debug-monitor:mon_42a1"},{"id":"cancel","label":"Stop release workflow","action":"cancel-release-flow"}],"dismissible":true}'
native-control wait release-flow --surface check-recovery --event control-activated --timeout 120000
```

Inspect unknown failures before retrying. Close the menu after handling its action, or replace it with updated progress when a retry starts.

---

## Handle events

Wait for the narrowest useful event: `control-changed`, `control-activated`, or `surface-closed`. The protocol also emits `surface-opened` and `surface-updated` for observers.

Buttons return an `invoke` action with the configured action ID and a payload containing current form values. Links return `open-url`, while `surface-closed` reports a `dismissed`, `action`, `replaced`, or `system` reason.

The host emits changed form values before the activated action, then closes an acted-on dialog or menu. Treat returned events as interaction truth and command, monitor, or service results as operational truth.

```json
{
  "type": "control-activated",
  "surfaceId": "deploy-review",
  "controlId": "deploy",
  "action": {
    "type": "invoke",
    "action": "confirm-deploy",
    "payload": {
      "release-note": "Improve job recovery",
      "backup-confirmed": true
    }
  }
}
```

---

## Verify outcomes

Replace ongoing status with a notification only after an authoritative result. Good evidence includes a zero exit code, completed delegation, migration record, or current health check.

```bash
native-control close release-flow release-progress
native-control open release-flow --json '{"id":"release-complete","kind":"notification","title":"Release verified","body":"api@2.4.0 is healthy; migration 018 applied and 248 tests passed.","controls":[],"dismissible":true,"severity":"success","durationMs":8000}'
```

Use `warning` or `error` for verified non-success outcomes. Do not infer completion from a started command, optimistic log line, or stale snapshot.

---

## Protect the user

Never show secrets, credentials, tokens, private source, personal data, or unredacted logs. Use secure inputs for necessary sensitive entry, but do not repeat returned values in notifications or logs.

Add only actions the agent can execute, mark only truly destructive buttons as destructive, and state consequences before consequential choices. Never continue after dismissal or cancellation.

Do not invent health, progress, durations, IDs, timestamps, or outcomes. Replace every sample value in these examples with current evidence before presenting it.

---

## Clean up

Close remaining surfaces, stop the named session, and interrupt the host with `Ctrl-C`. Clean up after success, dismissal, cancellation, timeout, and failure.

```bash
native-control close release-flow release-complete
native-control stop release-flow
```

Use `native-control remove release-flow` when the saved session is no longer needed. Use `native-control close-all` only when intentionally stopping every control session.
