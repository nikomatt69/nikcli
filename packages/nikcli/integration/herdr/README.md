# nikcli ↔ Herdr integration

[Herdr](https://herdr.dev) is a terminal workspace manager for coding agents.
It recognizes the agent running in each pane and drives a sidebar, an
attention queue, notifications, `herdr agent wait`, and session resume from
that. Agents plug into it in two independent ways, and nikcli ships both.

## 1. State reporting (works today)

An agent reports its own lifecycle over herdr's unix socket, which is
strictly better than screen scraping: herdr knows nikcli is blocked the
instant a permission is asked, not when a dialog happens to be visible.

nikcli reports the same calls herdr's own plugin-based integrations make:

| call                        | when                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pane.report_agent`         | every state change — `working` / `idle` / `blocked`                                                             |
| `pane.report_agent_session` | on a new root session, so herdr can resume the pane into that conversation (`session.resume_agents_on_restore`) |
| `pane.release_agent`        | when nikcli hands the pane back                                                                                 |

All of it is keyed to `source = "herdr:nikcli"`, `agent = "nikcli"` — the
identity herdr shows in the sidebar and matches in
`[ui.sidebar.agents.rows_by_agent]`.

Two equivalent implementations exist:

- **Built-in** (`src/plugin/herdr/`) — enabled automatically when nikcli
  runs inside a herdr pane (`HERDR_ENV=1` + `HERDR_SOCKET_PATH` +
  `HERDR_PANE_ID`). Outside a pane it is a hard no-op. Nothing to install.
- **Standalone** (`herdr-agent-state.js`) — the same logic as a single
  drop-in plugin file, in the exact shape `herdr integration install`
  writes for the other plugin-based agents:

  ```sh
  cp herdr-agent-state.js ~/.config/nikcli/plugin/herdr-agent-state.js
  ```

  nikcli scans `{plugin,plugins}/*.{ts,js}` under its config directories, so
  no config entry is needed. When this file is present the built-in stays
  dormant, so the two never double-report.

Check it from inside a pane with `herdr agent list` — nikcli appears as
`"agent": "nikcli"` with a live `agent_status`.

## 2. Screen detection (needs herdr upstream)

`nikcli.toml` is the agent-detection manifest: it lets herdr classify a
nikcli pane from its output alone, before any reporting starts. Herdr loads
manifests from its catalog (`https://herdr.dev/agent-detection/index.toml`)
into `~/.local/state/herdr/agent-detection/`, **skipping any manifest whose
id it does not know**, so this file only takes effect once herdr adds
`nikcli` to that catalog.

The same is true of `herdr integration install nikcli`: the target list is
compiled into the herdr binary (`IntegrationTarget` in its socket schema),
so shipping the installer path is an upstream change too.

What herdr needs, to make nikcli a first-class integration:

1. `nikcli` added to the known agent ids and to the `IntegrationTarget` enum.
2. `nikcli.toml` published in the agent-detection catalog.
3. The integration installer pointed at `~/.config/nikcli/plugin/herdr-agent-state.js`
   with the contents of `herdr-agent-state.js` (its `HERDR_INTEGRATION_ID`
   and `HERDR_INTEGRATION_VERSION` headers are already in the expected form).

Until then, copy the plugin file by hand — the reporting path in section 1
works on a stock herdr with no upstream change at all.
