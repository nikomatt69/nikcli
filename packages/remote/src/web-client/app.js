(function () {
  'use strict';
  var Terminal = (typeof window.Terminal !== 'undefined' && typeof window.Terminal.default === 'function') ? window.Terminal.default : window.Terminal;
  var FitAddonClass = (typeof window.FitAddon !== 'undefined' && typeof window.FitAddon.default === 'function') ? window.FitAddon.default : window.FitAddon;
  if (typeof Terminal !== 'function' || typeof FitAddonClass !== 'function') {
    document.body.innerHTML = '<p style="color:#f85149;padding:1rem;">Failed to load terminal (Terminal: ' + (typeof Terminal) + ', FitAddon: ' + (typeof FitAddonClass) + ').</p>';
    return;
  }

  var params = new URLSearchParams(location.search);
  var token = params.get('t') || '';

  var terminalEl = document.getElementById('terminal');
  var authScreen = document.getElementById('auth-screen');
  var authStatus = document.getElementById('auth-status');
  var statusDot = document.getElementById('status-dot');
  var statusText = document.getElementById('status-text');
  var input = document.getElementById('input');
  var sendBtn = document.getElementById('send');

  var ws = null;
  var reconnectAttempts = 0;
  var maxReconnectAttempts = 10;

  var term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'SF Mono, Fira Code, Consolas, monospace',
    theme: {
      background: '#0d1117',
      foreground: '#e6edf3',
      cursor: '#58a6ff',
      selectionBackground: '#30363d',
    },
    convertEol: true,
  });

  var fitAddon = new FitAddonClass();
  term.loadAddon(fitAddon);
  term.open(terminalEl);
  fitAddon.fit();

  term.writeln('\x1b[32mNikCLI Remote\x1b[0m');
  term.writeln('Connecting...');

  function setStatus(state, text) {
    statusDot.className = state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : '';
    statusText.textContent = text;
  }

  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host);

    ws.onopen = function () {
      setStatus('connecting', 'Authenticating...');
      ws.send(JSON.stringify({ type: 'auth', token: token }));
    };

    ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (_) {
        // ignore parse errors
      }
    };

    ws.onclose = function (event) {
      setStatus('disconnected', 'Disconnected');
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        var delay = Math.min(500 * reconnectAttempts, 5000);
        setTimeout(connect, delay);
      } else {
        authStatus.textContent = 'Connection failed. Refresh to retry.';
        authStatus.classList.add('error');
        authScreen.classList.remove('hidden');
      }
    };

    ws.onerror = function () {
      // errors are handled via onclose
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'auth:required':
        break;
      case 'auth:success':
        authScreen.classList.add('hidden');
        setStatus('connected', 'Connected');
        reconnectAttempts = 0;
        term.writeln('\x1b[32mConnected!\x1b[0m');
        fitAddon.fit();
        sendResize();
        break;
      case 'auth:failed':
        authStatus.textContent = 'Authentication failed - invalid token';
        authStatus.classList.add('error');
        authScreen.classList.remove('hidden');
        break;
      case 'terminal:output':
        var data = msg.payload && msg.payload.data !== undefined ? msg.payload.data : msg.data;
        if (data) {
          term.write(data);
        }
        break;
      case 'notification':
        showNotification(msg.payload);
        break;
      case 'session:end':
        term.writeln('\n\x1b[31m[Session ended]\x1b[0m\n');
        setStatus('disconnected', 'Session ended');
        break;
      default:
        break;
    }
  }

  function showNotification(n) {
    if (!n) return;
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal:input', payload: { data: data } }));
    }
  }

  function sendResize() {
    if (ws && ws.readyState === WebSocket.OPEN && term.rows && term.cols) {
      ws.send(JSON.stringify({ type: 'terminal:resize', payload: { cols: term.cols, rows: term.rows } }));
    }
  }

  term.onData(function (data) {
    send(data);
  });

  sendBtn.onclick = function () {
    if (input.value) {
      send(input.value + '\r');
      input.value = '';
    }
    input.focus();
  };

  input.onkeydown = function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendBtn.click();
    }
  };

  document.querySelectorAll('.qkey').forEach(function (btn) {
    btn.onclick = function () {
      var key = btn.dataset.key;
      send(key);
      input.focus();
    };
  });

  window.addEventListener('resize', function () {
    fitAddon.fit();
    sendResize();
  });

  setInterval(function () {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);

  if (token) {
    connect();
  } else {
    authStatus.textContent = 'Invalid session URL - missing token';
    authStatus.classList.add('error');
    authScreen.classList.remove('hidden');
  }
})();
