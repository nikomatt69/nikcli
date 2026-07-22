---
name: native-ui
description: Autonomously create, update, inspect, wait for, and close real native operating-system interfaces through persistent native-control sessions. Use for realtime task progress, native dialogs, popovers, menus, notifications, permissions, reviews, and user decisions where native UI improves clarity or agency.
---

# Native UI Control

Operate native surfaces with `native-control` using the same persistent-session model
as `terminal-control` and `browser-control`. A session remains alive across separate
commands, so always use a stable name and close it after verification.

---

## Start the renderer

The nikcli HTTP endpoint must be running and reachable from the native host. Start the
renderer in one long-running terminal, then use the same URL for the control session.

```bash
# Terminal 1
native-control host --url http://127.0.0.1:4096

# Terminal 2
native-control start ux-check --url http://127.0.0.1:4096
native-control open ux-check --json '{"id":"review","kind":"dialog","title":"Review changes","controls":[],"dismissible":true,"modal":true,"width":"medium"}'
native-control snapshot ux-check
native-control wait ux-check --surface review --event control-activated --timeout 120000
```

Use one popover and update it for realtime progress. Use dialogs only for decisions,
permissions, destructive actions, or required input. Never place secrets in visible UI.
Visible state and returned native events are the source of truth; do not infer success
from logs.

---

## Clean up

Close surfaces, stop the named session, and interrupt the renderer with `Ctrl-C`. Always
clean up after verification and failures.

```bash
native-control close ux-check review
native-control stop ux-check
```
