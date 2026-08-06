// nikcli's Herdr integration, in the exact shape `herdr integration install`
// uses for the other plugin-based agents (opencode, kilo).
//
// Install it by copying this file to the nikcli global plugin directory:
//
//     ~/.config/nikcli/plugin/herdr-agent-state.js
//
// nikcli scans `{plugin,plugins}/*.{ts,js}` under its config directories, so
// no config entry is needed. Once herdr ships `nikcli` as a built-in
// integration target, `herdr integration install nikcli` writes this same
// file and keeps it updated.
//
// nikcli also ships this integration as a built-in plugin. That built-in
// stays dormant when this file is present, so the two never double-report.
//
// HERDR_INTEGRATION_ID=nikcli
// HERDR_INTEGRATION_VERSION=1

import net from "node:net";

const SOURCE = "herdr:nikcli";
const AGENT = "nikcli";
let reportSeq = Date.now() * 1000;
let requestChain = Promise.resolve();
let reportedRootSessionID;

// Track child sessions so their events cannot replace the pane's root session.
// Their user prompts still project state without attaching the child session id.
const childSessions = new Set();
const CHILD_EVENT_STATES = new Map([
  ["permission.asked", "blocked"],
  ["question.asked", "blocked"],
  ["permission.replied", "working"],
  ["question.replied", "working"],
  ["question.rejected", "working"],
]);

function nextReportSeq() {
  reportSeq += 1;
  return reportSeq;
}

function sessionIDFromProperties(properties) {
  if (typeof properties?.sessionID === "string" && properties.sessionID)
    return properties.sessionID;
  if (typeof properties?.info?.id === "string" && properties.info.id)
    return properties.info.id;
  return undefined;
}

const SESSION_STATE_BY_STATUS = new Map([
  ["idle", "idle"],
  ["active", "working"],
  ["busy", "working"],
  ["pending", "working"],
  ["retry", "working"],
  ["running", "working"],
  ["streaming", "working"],
  ["working", "working"],
]);

function stateFromSessionStatus(status) {
  const kind = typeof status === "string" ? status : status?.type;
  return typeof kind === "string"
    ? SESSION_STATE_BY_STATUS.get(kind.toLowerCase())
    : undefined;
}

function request(method, params) {
  const pending = requestChain.then(() => requestOnce(method, params));
  requestChain = pending.catch(() => {});
  return pending;
}

function requestOnce(method, params) {
  const paneId = process.env.HERDR_PANE_ID;
  const socketPath = process.env.HERDR_SOCKET_PATH;

  if (!paneId || !socketPath) {
    return Promise.resolve();
  }

  const socketEndpoint =
    process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;

  const requestId = `${SOURCE}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
  const request = {
    id: requestId,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      seq: nextReportSeq(),
      ...params,
    },
  };

  return new Promise((resolve) => {
    const client = net.createConnection(socketEndpoint, () => {
      client.write(`${JSON.stringify(request)}\n`);
    });

    const finish = () => {
      client.destroy();
      resolve();
    };

    client.setTimeout(500, finish);
    client.on("data", finish);
    client.on("error", finish);
    client.on("end", finish);
    client.on("close", resolve);
  });
}

function reportSession(sessionID, sessionStartSource) {
  if (!sessionID) {
    return Promise.resolve();
  }
  const params = { agent_session_id: sessionID };
  if (sessionStartSource) {
    params.session_start_source = sessionStartSource;
  }
  return request("pane.report_agent_session", params);
}

function reportState(state, sessionID) {
  const params = { state };
  if (sessionID) {
    reportedRootSessionID = sessionID;
    params.agent_session_id = sessionID;
  }
  return request("pane.report_agent", params);
}

export const HerdrAgentStatePlugin = async () => {
  if (
    process.env.HERDR_ENV !== "1" ||
    !process.env.HERDR_SOCKET_PATH ||
    !process.env.HERDR_PANE_ID
  ) {
    return {};
  }

  return {
    "chat.message": async ({ sessionID }) => {
      if (sessionID && childSessions.has(sessionID)) {
        return;
      }
      await reportState("working", sessionID);
    },
    // nikcli surfaces tool calls as plugin hooks rather than bus events, so
    // they are wired explicitly to keep a long tool run from looking idle.
    "tool.execute.before": async ({ sessionID }) => {
      if (sessionID && childSessions.has(sessionID)) return;
      await reportState("working", sessionID);
    },
    "tool.execute.after": async ({ sessionID }) => {
      if (sessionID && childSessions.has(sessionID)) return;
      await reportState("working", sessionID);
    },
    event: async ({ event }) => {
      const type = event?.type;
      const properties = event?.properties ?? {};
      const sessionID = sessionIDFromProperties(properties);

      const info = properties.info;
      if (info?.id && info.parentID) {
        childSessions.add(info.id);
      }
      if (sessionID && childSessions.has(sessionID)) {
        const state = CHILD_EVENT_STATES.get(type);
        if (state) {
          await reportState(state);
        }
        return;
      }

      switch (type) {
        case "session.created":
          // A root session.created is a genuine new-session start (subagent
          // creates are dropped above). Signal it so herdr replaces the pane's
          // prior session id instead of treating the change as cross-talk.
          await reportSession(sessionID, "new");
          break;
        case "session.updated":
          if (sessionID && sessionID !== reportedRootSessionID) {
            await reportSession(sessionID);
          }
          break;
        case "session.status": {
          const state = stateFromSessionStatus(properties.status);
          if (state) {
            await reportState(state, sessionID);
          } else {
            await reportSession(sessionID);
          }
          break;
        }
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
        case "session.compacted":
          await reportState("working", sessionID);
          break;
        case "permission.asked":
        case "question.asked":
        case "session.error":
          await reportState("blocked", sessionID);
          break;
        case "session.idle":
          await reportState("idle", sessionID);
          break;
        case "session.deleted":
          break;
        default:
          break;
      }
    },
  };
};

export default HerdrAgentStatePlugin;
