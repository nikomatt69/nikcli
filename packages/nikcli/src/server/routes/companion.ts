import { Hono } from "hono"
import { cors } from "hono/cors"
import { Session } from "../../session"
import { lazy } from "../../util/lazy"
import { upgradeWebSocket } from "hono/bun"

const sessions = new Map<string, any>()
const cliSockets = new Map<string, any>()
const browserSockets = new Map<string, any[]>()

const CSS = `
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --border: #30363d;
  --text-primary: #c9d1d9;
  --text-secondary: #8b949e;
  --accent: #58a6ff;
  --green: #238636;
  --green-hover: #2ea043;
  --blue: #1f6feb;
  --blue-hover: #388bfd;
  --orange: #f0883e;
  --red: #da3633;
  --purple: #a371f7;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app { height: 100%; width: 100%; }
body { 
  font-family: var(--font-sans);
  background: var(--bg-primary); color: var(--text-primary);
  overflow: hidden;
}
.app { display: flex; height: 100%; width: 100%; }

/* Sidebar */
.sidebar {
  width: 260px; background: var(--bg-secondary); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; flex-shrink: 0;
}
.sidebar-header {
  padding: 16px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.sidebar-header h1 { font-size: 16px; color: var(--accent); font-weight: 600; }
.sidebar-content { flex: 1; overflow-y: auto; padding: 8px; }
.sidebar-section { margin-bottom: 16px; }
.sidebar-section-title {
  font-size: 11px; text-transform: uppercase; color: var(--text-secondary);
  padding: 8px 8px 4px; font-weight: 600; letter-spacing: 0.5px;
}
.session-item {
  display: flex; align-items: center; padding: 8px 12px; border-radius: 6px;
  cursor: pointer; transition: background 0.15s; gap: 8px;
}
.session-item:hover { background: var(--bg-tertiary); }
.session-item.active { background: var(--blue); }
.session-item .title { flex: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-item .status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.session-item .status-dot.running { background: var(--green); }
.session-item .status-dot.idle { background: var(--text-secondary); }
.session-item .status-dot.busy { background: var(--orange); animation: pulse 1s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.new-session-btn {
  margin: 8px; padding: 10px; background: var(--green); color: #fff;
  border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
  font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px;
}
.new-session-btn:hover { background: var(--green-hover); }

/* Main area */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }

/* Top bar */
.topbar {
  height: 48px; background: var(--bg-secondary); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 16px; gap: 8px; flex-shrink: 0;
}
.topbar-tabs { display: flex; gap: 4px; flex: 1; }
.topbar-tab {
  padding: 8px 16px; font-size: 13px; color: var(--text-secondary);
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
  transition: all 0.15s;
}
.topbar-tab:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.topbar-tab.active { background: var(--bg-tertiary); color: var(--accent); }
.topbar-actions { display: flex; gap: 8px; }
.icon-btn {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
  color: var(--text-secondary); font-size: 16px;
}
.icon-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

/* Messages area */
.messages-container { flex: 1; display: flex; overflow: hidden; }
.messages { flex: 1; overflow-y: auto; padding: 16px; }
.message { margin-bottom: 16px; animation: fadeIn 0.2s; max-width: 85%; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.message.user { margin-left: auto; }
.message.assistant { margin-right: auto; }
.message-role {
  font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; text-transform: uppercase; font-weight: 600;
}
.message-content {
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px;
  padding: 12px 16px; white-space: pre-wrap; word-wrap: break-word; line-height: 1.5; font-size: 14px;
}
.message.user .message-content { background: var(--blue); border-color: var(--blue); }
.message.assistant .message-content { border-radius: 12px 12px 12px 4px; }
.message.user .message-content { border-radius: 12px 12px 4px 12px; }

/* Tools */
.tool-block {
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px;
  margin: 8px 0; overflow: hidden;
}
.tool-header {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border); font-size: 13px;
}
.tool-icon { font-size: 14px; }
.tool-name { color: var(--purple); font-weight: 600; }
.tool-input {
  padding: 12px; font-family: var(--font-mono); font-size: 12px; background: var(--bg-primary);
  white-space: pre; overflow-x: auto; max-height: 200px; color: var(--text-primary);
}
.tool-result {
  padding: 12px; font-family: var(--font-mono); font-size: 12px;
  background: var(--bg-primary); border-top: 1px solid var(--border);
  white-space: pre-wrap; max-height: 200px; overflow-y: auto; color: #7ee787;
}
.tool-result.error { color: var(--red); }

/* Composer */
.composer {
  background: var(--bg-secondary); border-top: 1px solid var(--border); padding: 12px 16px;
  display: flex; gap: 12px; flex-shrink: 0;
}
.composer textarea {
  flex: 1; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary);
  padding: 12px 16px; border-radius: 8px; font-size: 14px; font-family: inherit;
  resize: none; min-height: 48px; max-height: 150px;
}
.composer textarea:focus { outline: none; border-color: var(--accent); }
.composer textarea:disabled { opacity: 0.5; }
.composer button {
  background: var(--green); color: #fff; border: none; padding: 12px 24px;
  border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;
  transition: background 0.15s; align-self: flex-end;
}
.composer button:hover { background: var(--green-hover); }
.composer button:disabled { opacity: 0.5; cursor: not-allowed; }

/* Permission banner */
.permission-banner {
  background: rgba(240, 136, 62, 0.1); border: 1px solid var(--orange); border-radius: 8px;
  padding: 12px 16px; margin: 8px 16px;
}
.permission-title { color: var(--orange); font-weight: 600; font-size: 13px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.permission-details {
  background: var(--bg-primary); padding: 10px; border-radius: 6px; font-family: var(--font-mono);
  font-size: 12px; overflow-x: auto; margin-bottom: 10px;
}
.permission-actions { display: flex; gap: 8px; }
.permission-actions button {
  padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: none;
}
.btn-deny { background: var(--bg-tertiary); color: var(--text-primary); }
.btn-deny:hover { background: var(--red); color: #fff; }
.btn-allow { background: var(--green); color: #fff; }
.btn-allow:hover { background: var(--green-hover); }

/* Status */
.status-indicator {
  display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary);
}
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot.connected { background: var(--green); }
.status-dot.disconnected { background: var(--red); }
.status-dot.thinking { background: var(--orange); animation: pulse 1s infinite; }

/* Diff panel */
.diff-panel { flex: 1; border-left: 1px solid var(--border); overflow: hidden; display: flex; flex-direction: column; }
.diff-header {
  padding: 12px 16px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border);
  font-size: 13px; font-weight: 600;
}
.diff-content { flex: 1; overflow: auto; padding: 12px; font-family: var(--font-mono); font-size: 12px; }
.diff-file { margin-bottom: 16px; }
.diff-file-name { color: var(--accent); margin-bottom: 8px; font-weight: 600; }
.diff-hunk { background: var(--bg-secondary); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.diff-add { color: #7ee787; }
.diff-del { color: #f85149; }
.diff-line { white-space: pre; }

/* Empty states */
.empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; color: var(--text-secondary); gap: 12px;
}
.empty-state h2 { font-size: 20px; color: var(--text-primary); }
.empty-state p { font-size: 14px; }

/* Home page */
.home-container {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; padding: 40px; text-align: center;
}
.home-logo { font-size: 48px; margin-bottom: 16px; }
.home-title { font-size: 28px; color: var(--accent); margin-bottom: 8px; }
.home-subtitle { color: var(--text-secondary); margin-bottom: 32px; font-size: 16px; }
.home-actions { display: flex; gap: 12px; }
.home-btn {
  padding: 14px 28px; font-size: 15px; font-weight: 500; border-radius: 8px; cursor: pointer;
  border: none; transition: all 0.15s;
}
.home-btn.primary { background: var(--green); color: #fff; }
.home-btn.primary:hover { background: var(--green-hover); }
.home-btn.secondary { background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border); }
.home-btn.secondary:hover { background: var(--border); }

/* Responsive */
@media (max-width: 768px) {
  .sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 100;
    transform: translateX(-100%); transition: transform 0.2s; }
  .sidebar.open { transform: translateX(0); }
  .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 99; }
}
`

const JS = `
const API_BASE = '';
let currentSessionId = null;
let eventSource = null;
let isLoading = false;
let pendingPermission = null;
let messages = [];
let diffs = [];
let activeTab = 'chat';

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function api(endpoint, options = {}) {
  const res = await fetch(API_BASE + endpoint, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || ("HTTP " + res.status + ": " + res.statusText));
  }
  return res.json();
}

async function loadSessions() {
  const sessions = await api('/session?limit=50');
  renderSidebar(sessions);
  return sessions;
}

function renderSidebar(sessions) {
  const sidebar = $('#sidebar-sessions');
  if (!sessions || sessions.length === 0) {
    sidebar.innerHTML = '<div style="padding: 16px; color: var(--text-secondary); font-size: 13px;">No sessions</div>';
    return;
  }
  
  sidebar.innerHTML = sessions.map(s => \`
    <div class="session-item \${s.id === currentSessionId ? 'active' : ''}" data-id="\${s.id}" onclick="selectSession('\${s.id}')">
      <span class="status-dot \${getSessionStatus(s)}"></span>
      <span class="title">\${escapeHtml(s.title || s.id.slice(0, 8))}</span>
    </div>
  \`).join('');
}

function getSessionStatus(session) {
  return 'idle';
}

async function selectSession(sessionId) {
  if (currentSessionId === sessionId) return;
  currentSessionId = sessionId;
  
  renderSidebar(await loadSessions());
  loadSessionData(sessionId);
  showChatView();
}

async function loadSessionData(sessionId) {
  try {
    const [msgs, sessionInfo] = await Promise.all([
      api('/session/' + sessionId + '/message?limit=100'),
      api('/session/' + sessionId)
    ]);
    
    messages = msgs || [];
    renderMessages();
    
    if (sessionInfo.summary?.diffs?.length > 0) {
      diffs = sessionInfo.summary.diffs;
    }
  } catch (e) {
    console.error('Failed to load session:', e);
  }
}

function renderMessages() {
  const container = $('#messages');
  if (!container) return;
  
  if (messages.length === 0) {
    container.innerHTML = '<div class="empty-state"><h2>Start a conversation</h2><p>Send a message to begin</p></div>';
    return;
  }
  
  let html = '';
  messages.forEach(msg => {
    if (!msg.info || !msg.info.role) return;
    
    const role = msg.info.role;
    let messageText = '';
    
    if (msg.parts) {
      msg.parts.forEach(part => {
        if (part.type === 'text') {
          messageText += part.text;
        } else if (part.type === 'tool-use') {
          let inputStr = '';
          try { inputStr = JSON.stringify(part.input, null, 2); } catch(e) { inputStr = String(part.input); }
          html += \`<div class="tool-block">
            <div class="tool-header"><span class="tool-icon">🔧</span><span class="tool-name">\${escapeHtml(part.name)}</span></div>
            <pre class="tool-input">\${escapeHtml(inputStr)}</pre>
          </div>\`;
        } else if (part.type === 'tool-result') {
          let resultStr = '';
          try { resultStr = typeof part.content === 'object' ? JSON.stringify(part.content, null, 2) : String(part.content); } 
          catch(e) { resultStr = String(part.content); }
          const isError = part.isError;
          html += \`<pre class="tool-result \${isError ? 'error' : ''}">\${escapeHtml(resultStr)}</pre>\`;
        }
      });
    }
    
    if (messageText) {
      html += \`<div class="message \${role}">
        <div class="message-role">\${role}</div>
        <div class="message-content">\${escapeHtml(messageText)}</div>
      </div>\`;
    }
  });
  
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function showChatView() {
  $('#app').innerHTML = \`
    <div class="sidebar">
      <div class="sidebar-header">
        <h1>nikcli</h1>
      </div>
      <button class="new-session-btn" onclick="createSession()">+ New Session</button>
      <div class="sidebar-content">
        <div class="sidebar-section-title">Sessions</div>
        <div id="sidebar-sessions"></div>
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <div class="topbar-tabs">
          <button class="topbar-tab active" onclick="setTab('chat')">Chat</button>
          <button class="topbar-tab" onclick="setTab('diff')">Diff</button>
        </div>
        <div class="status-indicator">
          <span class="status-dot" id="statusDot"></span>
          <span id="statusText">Connected</span>
        </div>
        <div class="topbar-actions">
          <button class="icon-btn" onclick="interruptSession()" title="Interrupt">⏹</button>
          <button class="icon-btn" onclick="deleteCurrentSession()" title="Delete">🗑</button>
        </div>
      </div>
      <div id="permissionBanner" style="display:none;"></div>
      <div class="messages-container">
        <div class="messages" id="messages"></div>
        <div class="diff-panel" id="diffPanel" style="display:none;">
          <div class="diff-header">Changes</div>
          <div class="diff-content" id="diffContent"></div>
        </div>
      </div>
      <form class="composer" id="composer">
        <textarea id="input" placeholder="Type a message..." rows="1"></textarea>
        <button type="submit" id="sendBtn">Send</button>
      </form>
    </div>
  \`;
  
  loadSessions();
  renderMessages();
  connectEvents();
  setupComposer();
}

function setTab(tab) {
  activeTab = tab;
  $$('.topbar-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  
  $('#diffPanel').style.display = tab === 'diff' ? 'flex' : 'none';
  $('#messages').style.display = tab === 'chat' ? 'block' : 'none';
  
  if (tab === 'diff') {
    renderDiffs();
  }
}

function renderDiffs() {
  const container = $('#diffContent');
  if (!diffs || diffs.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No changes yet</p></div>';
    return;
  }
  
  let html = '';
  diffs.forEach(diff => {
    html += \`<div class="diff-file">
      <div class="diff-file-name">\${escapeHtml(diff.path || diff.file || 'Unknown')}</div>\`;
    
    if (diff.hunks) {
      diff.hunks.forEach(hunk => {
        html += \`<div class="diff-hunk">\`;
        hunk.lines.forEach(line => {
          const prefix = line.startsWith('+') ? '+' : line.startsWith('-') ? '-' : ' ';
          const cls = line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : '';
          html += \`<div class="diff-line \${cls}">\${escapeHtml(line)}</div>\`;
        });
        html += \`</div>\`;
      });
    }
    html += \`</div>\`;
  });
  container.innerHTML = html;
}

async function createSession() {
  try {
    const session = await api('/session', { method: 'POST', body: JSON.stringify({}) });
    currentSessionId = session.id;
    messages = [];
    diffs = [];
    showChatView();
  } catch (e) {
    console.error('Failed to create session:', e);
    alert('Failed to create session');
  }
}

async function deleteCurrentSession() {
  if (!currentSessionId) return;
  if (!confirm('Delete this session?')) return;
  
  try {
    await api('/session/' + currentSessionId, { method: 'DELETE' });
    currentSessionId = null;
    showHome();
  } catch (e) {
    console.error('Failed to delete session:', e);
  }
}

async function interruptSession() {
  if (!currentSessionId) return;
  try {
    await api('/session/' + currentSessionId + '/abort', { method: 'POST' });
    setStatus('idle');
  } catch (e) {
    console.error('Failed to abort:', e);
  }
}

function setupComposer() {
  const composer = $('#composer');
  const input = $('#input');
  const sendBtn = $('#sendBtn');
  
  if (!composer) return;
  
  input.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
  });
  
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composer.dispatchEvent(new Event('submit'));
    }
  });
  
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content || isLoading) return;
    
    input.value = '';
    input.style.height = 'auto';
    input.disabled = true;
    sendBtn.disabled = true;
    setStatus('thinking');
    
    try {
      const result = await api('/session/' + currentSessionId + '/message', {
        method: 'POST',
        body: JSON.stringify({ parts: [{ type: 'text', text: content }] })
      });
      
      if (result.info) {
        await loadSessionData(currentSessionId);
      }
      setStatus('idle');
    } catch (e) {
      console.error('Failed to send:', e);
      setStatus('idle');
      alert('Failed to send message: ' + e.message);
    }
    
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  });
}

function setStatus(status) {
  const dot = $('#statusDot');
  const text = $('#statusText');
  if (!dot || !text) return;
  
  dot.className = 'status-dot ' + (status === 'thinking' ? 'thinking' : status === 'idle' ? 'connected' : 'disconnected');
  text.textContent = status === 'thinking' ? 'Thinking...' : status === 'idle' ? 'Connected' : 'Disconnected';
  isLoading = status === 'thinking';
  
  const input = $('#input');
  const sendBtn = $('#sendBtn');
  if (input) input.disabled = isLoading;
  if (sendBtn) sendBtn.disabled = isLoading;
}

function connectEvents() {
  if (eventSource) eventSource.close();
  
  eventSource = new EventSource(API_BASE + '/global/event');
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const payload = data.payload || data;
      handleEvent(payload);
    } catch (e) {
      // Ignore parse errors
    }
  };
  
  eventSource.onerror = () => {
    setStatus('disconnected');
    setTimeout(connectEvents, 3000);
  };
}

function handleEvent(data) {
  const sessionID = data.properties?.sessionID;
  if (sessionID && sessionID !== currentSessionId) return;
  
  if (data.type === 'messagev2.updated') {
    const msg = data.properties;
    if (msg && msg.info && msg.info.sessionID === currentSessionId) {
      loadSessionData(currentSessionId);
    }
  } else if (data.type === 'session.error') {
    setStatus('idle');
  } else if (data.type === 'permission.asked') {
    const perm = data.properties;
    if (perm && perm.sessionID === currentSessionId) {
      showPermission(perm);
    }
  } else if (data.type === 'session.status') {
    const status = data.properties?.status;
    if (status === 'busy' || status === 'generating') {
      setStatus('thinking');
    } else if (status === 'idle') {
      setStatus('idle');
    }
  }
}

function showPermission(permission) {
  pendingPermission = permission;
  const banner = $('#permissionBanner');
  if (!banner) return;
  
  let details = '';
  try {
    details = JSON.stringify({ permission: permission.permission, patterns: permission.patterns, metadata: permission.metadata }, null, 2);
  } catch(e) { details = String(permission.permission); }
  
  banner.style.display = 'block';
  banner.innerHTML = \`
    <div class="permission-banner">
      <div class="permission-title"><span>⚠️</span> Permission: \${escapeHtml(permission.permission)}</div>
      <pre class="permission-details">\${escapeHtml(details)}</pre>
      <div class="permission-actions">
        <button class="btn-deny" onclick="respondPermission(false)">Deny</button>
        <button class="btn-allow" onclick="respondPermission(true)">Allow</button>
      </div>
    </div>
  \`;
}

async function respondPermission(allowed) {
  if (!pendingPermission || !currentSessionId) return;
  
  const id = pendingPermission.id;
  try {
    await api('/session/' + currentSessionId + '/permissions/' + id, {
      method: 'POST',
      body: JSON.stringify({ response: allowed ? 'once' : 'reject' })
    });
  } catch(e) {
    console.error('Failed to respond:', e);
  }
  
  pendingPermission = null;
  $('#permissionBanner').style.display = 'none';
}

function showHome() {
  $('#app').innerHTML = \`
    <div class="sidebar">
      <div class="sidebar-header">
        <h1>nikcli</h1>
      </div>
      <button class="new-session-btn" onclick="createSession()">+ New Session</button>
      <div class="sidebar-content">
        <div class="sidebar-section-title">Sessions</div>
        <div id="sidebar-sessions"></div>
      </div>
    </div>
    <div class="main">
      <div class="home-container">
        <div class="home-logo">🤖</div>
        <h1 class="home-title">nikcli</h1>
        <p class="home-subtitle">Web interface for nikcli sessions</p>
        <div class="home-actions">
          <button class="home-btn primary" onclick="createSession()">New Session</button>
        </div>
      </div>
    </div>
  \`;
  
  loadSessions();
}

// Initialize
async function init() {
  const hash = window.location.hash;
  const match = hash.match(/[#?]session=([^&]+)/);
  
  if (match && match[1]) {
    currentSessionId = match[1];
    showChatView();
  } else {
    showHome();
  }
}

init();
`

const HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>nikcli Companion</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${CSS}</style>
</head>
<body>
  <div id="app"></div>
  <script>${JS}</script>
</body>
</html>
`

export const CompanionRoutes = lazy(() => {
  const app = new Hono()

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  )

  app.get("/", (c) => {
    const host = c.req.query("host")
    if (host) {
      // Validate and sanitize host to prevent XSS
      // Only allow valid hostname characters, no quotes or special chars
      const sanitizedHost = host
        .replace(/^https?:\/\//, "") // Remove protocol
        .replace(/[^\w.-]/g, "_") // Replace invalid chars with underscore
        .substring(0, 253) // Max hostname length

      // Validate it's a reasonable hostname
      if (!/^[a-zA-Z0-9][\w.-]*$/.test(sanitizedHost)) {
        return c.html(HTML)
      }

      const protocol = host.startsWith("https") ? "https" : "http"
      return c.html(HTML.replace("const API_BASE = '';", `const API_BASE = '${protocol}://${sanitizedHost}';`))
    }
    return c.html(HTML)
  })

  return app
})
