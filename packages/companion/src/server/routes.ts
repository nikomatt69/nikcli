import { Hono } from "hono"
import { cors } from "hono/cors"
import { getSessions } from "./ws-routes"

export function CompanionRoutes() {
  const app = new Hono()
  const sessions = getSessions()

  app.use("*", cors())

  app.get("/", (c) => {
    const url = new URL(c.req.url)
    if (url.pathname === "/companion/") {
      return c.redirect("/companion")
    }

    const host = c.req.header("host")?.split(":")[0] || "localhost"
    const port = c.req.header("host")?.split(":")[1] || "4096"

    return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>nikcli Companion</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0d1117; color: #c9d1d9; min-height: 100vh;
        }
        .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
        h1 { color: #58a6ff; margin-bottom: 8px; }
        .subtitle { color: #8b949e; margin-bottom: 32px; }
        .card {
          background: #161b22; border: 1px solid #30363d; border-radius: 6px;
          padding: 20px; margin-bottom: 16px;
        }
        .btn {
          background: #238636; color: #fff; border: none; padding: 10px 20px;
          border-radius: 6px; cursor: pointer; font-size: 14px; margin-right: 8px;
        }
        .btn:hover { background: #2ea043; }
        input {
          background: #0d1117; border: 1px solid #30363d; color: #c9d1d9;
          padding: 10px; border-radius: 6px; width: 100%; margin-bottom: 12px;
        }
        label { display: block; margin-bottom: 6px; color: #8b949e; }
        .hint { color: #8b949e; font-size: 13px; }
        .session-list { margin-top: 20px; }
        .session-item {
          background: #0d1117; padding: 12px; margin-bottom: 8px;
          border-radius: 6px; display: flex; justify-content: space-between;
        }
        .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
        .status.running { background: #238636; }
        .status.waiting { background: #f0883e; }
        .status.stopped { background: #8b949e; }
        code { background: #0d1117; padding: 2px 6px; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>nikcli Companion</h1>
        <p class="subtitle">Web UI for nikcli sessions</p>
        
        <div class="card">
          <h2>Create Session</h2>
          <button id="createSession" class="btn">Create New Session</button>
        </div>
        
        <div class="card">
          <h2>Active Sessions</h2>
          <div id="sessionsList" class="session-list"></div>
        </div>
        
        <div class="card">
          <h2>How It Works</h2>
          <p class="hint">
            1. Create a session above<br>
            2. Run nikcli with the SDK URL:<br>
            <code id="instructions" style="display: block; margin: 8px 0; padding: 12px; background: #0d1117; border-radius: 4px; color: #7ee787; font-family: monospace; white-space: pre-wrap; word-break: break-all;"></code>
            3. Interact with nikcli through this UI
          </p>
        </div>
      </div>
      
      <script>
        const API_BASE = window.location.origin;
        
        async function loadSessions() {
          const res = await fetch(API_BASE + '/companion/api/sessions');
          const sessions = await res.json();
          const list = document.getElementById('sessionsList');
          
          if (sessions.length === 0) {
            list.innerHTML = '<p style="color: #8b949e;">No active sessions</p>';
            return;
          }
          
          list.innerHTML = sessions.map(s => \`
            <div class="session-item">
              <div>
                <span class="status \${s.status}"></span>
                <strong>\${s.id.slice(0, 8)}</strong>
                <span style="color: #8b949e; margin-left: 8px;">\${s.model || ''}</span>
              </div>
              <button onclick="deleteSession('\${s.id}')" style="background: #da3633; color: #fff; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer;">Delete</button>
            </div>
          \`).join('');
        }
        
        document.getElementById('createSession').addEventListener('click', async () => {
          const res = await fetch(API_BASE + '/companion/api/sessions', { method: 'POST' });
          if (!res.ok) {
            const text = await res.text();
            alert('Failed to create session: ' + (text || res.statusText));
            return;
          }
          const data = await res.json();
          if (data.sessionId) {
            document.getElementById('instructions').textContent = data.instructions;
            loadSessions();
          }
        });
        
        async function deleteSession(id) {
          await fetch(API_BASE + '/companion/api/sessions/' + id, { method: 'DELETE' });
          loadSessions();
        }
        
        loadSessions();
      </script>
    </body>
    </html>
  `)
  })

  app.post("/api/sessions", (c) => {
    const sessionId = crypto.randomUUID()
    const host = c.req.header("host")?.split(":")[0] || "localhost"
    const port = c.req.header("host")?.split(":")[1] || "80"

    sessions.set(sessionId, {
      id: sessionId,
      status: "waiting",
      createdAt: Date.now(),
      messages: [],
    })

    return c.json({
      sessionId,
      wsUrl: `ws://${host}:${port}/companion/ws/${sessionId}`,
      cliUrl: `ws://${host}:${port}/companion/cli/${sessionId}`,
      instructions: `nikcli --sdk-url ws://${host}:${port}/companion/cli/${sessionId} --print --output-format stream-json --input-format stream-json -p ""`,
    })
  })

  app.get("/api/sessions", (c) => {
    const allSessions = Array.from(sessions.values())
    return c.json(allSessions)
  })

  app.get("/api/sessions/:id", (c) => {
    const id = c.req.param("id")
    const session = sessions.get(id)

    if (!session) {
      return c.json({ error: "Session not found" }, 404)
    }

    return c.json(session)
  })

  app.delete("/api/sessions/:id", (c) => {
    const id = c.req.param("id")
    sessions.delete(id)
    return c.json({ success: true })
  })

  return app
}
