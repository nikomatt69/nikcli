export function getWebClient(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#000000">
  <title>NikCLI Remote</title>
  <style>
    :root {
      --bg: #000000;
      --bg-secondary: #232323;
      --fg: #e6edf3;
      --fg-muted: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --warning: #d29922;
      --error: #f85149;
      --border: #30363d;
      --font-mono: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }

    html, body { height: 100%; background: var(--bg); color: var(--fg); font-family: var(--font-mono); font-size: 14px; overflow: hidden; touch-action: manipulation; }

    #app { display: flex; flex-direction: column; height: 100%; height: 100dvh; }

    #header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    #header h1 { font-size: 16px; font-weight: 600; color: var(--accent); display: flex; align-items: center; gap: 8px; }

    #header h1::before { content: ''; width: 10px; height: 10px; background: var(--accent); border-radius: 2px; }

    #status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-muted); }

    #status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--error); transition: background 0.3s; }

    #status-dot.connected { background: var(--success); }

    #status-dot.connecting { background: var(--warning); animation: pulse 1s infinite; }

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    #terminal-container { flex: 1; overflow: hidden; position: relative; }

    #terminal {
      position: absolute;
      inset: 0;
      height: 100%;
      width: 100%;
      outline: none;
      overflow: hidden;
    }

    #terminal canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    #terminal::-webkit-scrollbar { width: 6px; }

    #terminal::-webkit-scrollbar-track { background: var(--bg); }

    #terminal::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    .cursor { display: inline-block; width: 8px; height: 16px; background: var(--fg); animation: blink 1s step-end infinite; vertical-align: text-bottom; }

    @keyframes blink { 50% { opacity: 0; } }

    #notifications { position: fixed; top: 60px; left: 12px; right: 12px; z-index: 1000; pointer-events: none; }

    .notification {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 8px;
      animation: slideIn 0.3s ease;
      pointer-events: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }

    .notification.success { border-left: 3px solid var(--success); }
    .notification.error { border-left: 3px solid var(--error); }
    .notification.warning { border-left: 3px solid var(--warning); }
    .notification.info { border-left: 3px solid var(--accent); }

    .notification h4 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .notification p { font-size: 12px; color: var(--fg-muted); }

    @keyframes slideIn { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    #quickkeys { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; padding: 8px 12px; background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0; }

    .qkey {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 4px;
      color: var(--fg);
      font-size: 11px;
      font-family: var(--font-mono);
      text-align: center;
      cursor: pointer;
      user-select: none;
      transition: background 0.1s, transform 0.1s;
    }

    .qkey:active { background: var(--border); transform: scale(0.95); }
    .qkey.wide { grid-column: span 2; }
    .qkey.accent { background: var(--accent); border-color: var(--accent); color: #fff; }

    #input-container { padding: 12px; background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0; }
    #input-row { display: flex; gap: 8px; }

    #input {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      color: var(--fg);
      font-family: var(--font-mono);
      font-size: 16px;
      outline: none;
      transition: border-color 0.2s;
    }

    #input:focus { border-color: var(--accent); }
    #input::placeholder { color: var(--fg-muted); }

    #send {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      font-family: var(--font-mono);
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
    }

    #send:active { opacity: 0.8; transform: scale(0.98); }

    #auth-screen {
      position: fixed;
      inset: 0;
      background: var(--bg);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      z-index: 2000;
    }

    #auth-screen.hidden { display: none; }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    #auth-screen p { color: var(--fg-muted); font-size: 14px; }
    #auth-screen .error { color: var(--error); }

    @media (max-height: 500px) {
      #quickkeys { grid-template-columns: repeat(12, 1fr); padding: 6px 8px; }
      .qkey { padding: 8px 2px; font-size: 10px; }
      #terminal { font-size: 12px; }
    }
  </style>
</head>
<body>
  <div id="app">
    <div id="auth-screen">
      <div class="spinner"></div>
      <p id="auth-status">Connecting to NikCLI...</p>
    </div>

    <header id="header">
      <h1>NikCLI Remote</h1>
      <div id="status">
        <span id="status-dot" class="connecting"></span>
        <span id="status-text">Connecting</span>
      </div>
    </header>

    <div id="terminal-container">
      <div id="terminal"></div>
    </div>

    <div id="notifications"></div>

    <div id="quickkeys">
      <button class="qkey" data-key="\\t">Tab</button>
      <button class="qkey" data-key="\\x1b[A">↑</button>
      <button class="qkey" data-key="\\x1b[B">↓</button>
      <button class="qkey" data-key="\\x1b[D">←</button>
      <button class="qkey" data-key="\\x1b[C">→</button>
      <button class="qkey" data-key="\\x1b">Esc</button>
      <button class="qkey" data-key="\\x03">^C</button>
      <button class="qkey" data-key="\\x04">^D</button>
      <button class="qkey" data-key="\\x1a">^Z</button>
      <button class="qkey" data-key="\\x0c">^L</button>
      <button class="qkey wide accent" data-key="\\r">Enter ⏎</button>
    </div>

    <div id="input-container">
      <div id="input-row">
        <input type="text" id="input" placeholder="Type command..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <button id="send">Send</button>
      </div>
    </div>
  </div>

  <script>
    (function() {
      'use strict';

      const params = new URLSearchParams(location.search);
      const token = params.get('t');

      const terminal = document.getElementById('terminal');
      terminal.setAttribute('tabindex', '0');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('send');
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      const authScreen = document.getElementById('auth-screen');
      const authStatus = document.getElementById('auth-status');
      const notifications = document.getElementById('notifications');

      let ws = null;
      let reconnectAttempts = 0;
      const maxReconnectAttempts = 5;
      let term = null;
      let termReady = false;
      let ghosttyModule = null;
      let ghosttyLoading = null;
      const fontSize = 14;
      const fontFamily = 'SF Mono, Fira Code, Consolas, monospace';

      function connect() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(protocol + '//' + location.host);

        ws.onopen = function() {
          setStatus('connecting', 'Authenticating...');
          ws.send(JSON.stringify({ type: 'auth', token: token }));
        };

        ws.onmessage = function(event) {
          try {
            const msg = JSON.parse(event.data);
            handleMessage(msg);
          } catch (e) {
            console.error('Parse error:', e);
          }
        };

        ws.onclose = function() {
          setStatus('disconnected', 'Disconnected');
          if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            const delay = Math.min(2000 * reconnectAttempts, 10000);
            setTimeout(connect, delay);
          } else {
            authStatus.textContent = 'Connection failed. Refresh to retry.';
            authStatus.classList.add('error');
            authScreen.classList.remove('hidden');
          }
        };

        ws.onerror = function() {
          console.error('WebSocket error');
        };
      }

      terminal.addEventListener('click', function() {
        terminal.focus();
      });

      function handleMessage(msg) {
        switch (msg.type) {
          case 'auth:required':
            break;

          case 'auth:success':
            authScreen.classList.add('hidden');
            setStatus('connected', 'Connected');
            reconnectAttempts = 0;
            initTerminal();
            break;

          case 'auth:failed':
            authStatus.textContent = 'Authentication failed';
            authStatus.classList.add('error');
            break;

          case 'terminal:output':
            {
              const data = (msg.payload && msg.payload.data) || msg.data;
              if (data) writeToTerminal(data);
            }
            break;

          case 'notification':
            showNotification(msg.payload);
            break;

          case 'session:end':
            writeToTerminal('\\n\\x1b[31m[Session ended]\\x1b[0m\\n');
            setStatus('disconnected', 'Session ended');
            break;

          default:
            console.log('Unknown message:', msg.type);
        }
      }

      function initTerminal() {
        if (termReady) return;
        loadGhostty().then(function(mod) {
          const created = createGhosttyTerminal(mod);
          if (!created) {
            authStatus.textContent = 'ghostty-web not available. Install dependencies and reload.';
            authStatus.classList.add('error');
            authScreen.classList.remove('hidden');
            return;
          }
          term = created;
          termReady = true;
          mountTerminal(term);
          bindTerminalInput(term);
          fitTerminal();
          terminal.focus();
        });
      }

      function loadGhostty() {
        if (ghosttyModule) return Promise.resolve(ghosttyModule);
        if (!ghosttyLoading) {
          ghosttyLoading = import('/ghostty-web.js')
            .then(function(mod) {
              ghosttyModule = mod;
              return mod;
            })
            .catch(function() {
              return null;
            });
        }
        return ghosttyLoading;
      }

      function createGhosttyTerminal(mod) {
        const candidate = mod && (mod.default || mod.GhosttyWeb || mod.Ghostty || mod.Terminal || mod);
        const lib =
          candidate ||
          window.GhosttyWeb ||
          window.Ghostty ||
          window.ghostty ||
          window.Terminal ||
          (window.ghosttyWeb && window.ghosttyWeb.default) ||
          null;

        if (!lib) return null;

        const options = {
          cols: 80,
          rows: 24,
          fontSize: fontSize,
          fontFamily: fontFamily,
          cursorBlink: true,
        };

        if (lib.Terminal) return new lib.Terminal(options);
        if (lib.default && lib.default.Terminal) return new lib.default.Terminal(options);
        if (typeof lib === 'function') return new lib(options);
        if (lib.createTerminal) return lib.createTerminal(options);
        return null;
      }

      function mountTerminal(instance) {
        if (instance.open) {
          instance.open(terminal);
          return;
        }
        if (instance.attachTo) {
          instance.attachTo(terminal);
          return;
        }
        if (instance.mount) {
          instance.mount(terminal);
          return;
        }
        if (instance.element) {
          terminal.appendChild(instance.element);
        }
      }

      function writeToTerminal(text) {
        if (!term) return;
        if (term.write) {
          term.write(text);
          return;
        }
        if (term.writeUtf8) {
          term.writeUtf8(text);
          return;
        }
        if (term.writeString) {
          term.writeString(text);
          return;
        }
        if (term.feed) {
          term.feed(text);
          return;
        }
      }

      function bindTerminalInput(instance) {
        if (instance.onData) {
          instance.onData(function(data) {
            send(data);
          });
          return;
        }
        if (instance.on) {
          instance.on('data', function(data) {
            send(data);
          });
          instance.on('key', function(data) {
            send(data);
          });
          instance.on('input', function(data) {
            send(data);
          });
        }
      }

      function fitTerminal() {
        if (!term) return;
        const rect = terminal.getBoundingClientRect();
        const cell = getCellSize();
        const cols = Math.max(10, Math.floor(rect.width / cell.width));
        const rows = Math.max(4, Math.floor(rect.height / cell.height));

        if (term.resize) {
          term.resize(cols, rows);
        } else if (term.setSize) {
          term.setSize(cols, rows);
        }

        sendResize(cols, rows);
      }

      function getCellSize() {
        if (term?.cellSize) return term.cellSize;
        if (term?.getCellSize) return term.getCellSize();
        return { width: fontSize * 0.6, height: fontSize * 1.4 };
      }

      function setStatus(state, text) {
        statusDot.className = state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : '';
        statusText.textContent = text;
      }

      function send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal:input', payload: { data: data } }));
        }
      }

      function sendResize(cols, rows) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'terminal:resize', payload: { cols: cols, rows: rows } }));
        }
      }

      function showNotification(n) {
        if (!n) return;
        const el = document.createElement('div');
        el.className = 'notification ' + (n.type || 'info');
        el.innerHTML = '<h4>' + escapeHtml(n.title || 'Notification') + '</h4>' +
                       '<p>' + escapeHtml(n.body || '') + '</p>';
        notifications.appendChild(el);
        setTimeout(function() { el.remove(); }, 5000);
      }

      function escapeHtml(text) {
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      sendBtn.onclick = function() {
        if (input.value) {
          send(input.value + '\\r');
          input.value = '';
        }
        input.focus();
      };

      input.onkeydown = function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendBtn.click();
        }
      };

      document.querySelectorAll('.qkey').forEach(function(btn) {
        btn.onclick = function() {
          const key = btn.dataset.key;
          const decoded = key
            .replace(/\\\\x([0-9a-f]{2})/gi, function(_, hex) {
              return String.fromCharCode(parseInt(hex, 16));
            })
            .replace(/\\\\t/g, '\\t')
            .replace(/\\\\r/g, '\\r')
            .replace(/\\\\n/g, '\\n');
          send(decoded);
          input.focus();
        };
      });

      window.addEventListener('resize', function() {
        fitTerminal();
      });

      setInterval(function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);

      if (token) {
        initTerminal();
        connect();
      } else {
        authStatus.textContent = 'Invalid session URL';
        authStatus.classList.add('error');
      }
    })();
  </script>
</body>
</html>`
}
