import { Hono } from "hono"
import { cors } from "hono/cors"

const app = new Hono()

app.use("*", cors())

app.get("/", (c) => {
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
        .btn-danger { background: #da3633; }
        .btn-danger:hover { background: #f85149; }
        input {
          background: #0d1117; border: 1px solid #30363d; color: #c9d1d9;
          padding: 10px; border-radius: 6px; width: 100%; margin-bottom: 12px;
        }
        label { display: block; margin-bottom: 6px; color: #8b949e; }
        .sessions { margin-top: 24px; }
        .session {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px; border-bottom: 1px solid #30363d;
        }
        .session:last-child { border-bottom: none; }
        .status { 
          display: inline-block; width: 8px; height: 8px; border-radius: 50%;
          margin-right: 8px;
        }
        .status.running { background: #238636; }
        .status.stopped { background: #8b949e; }
        .status.error { background: #da3633; }
        .code-block {
          background: #0d1117; padding: 16px; border-radius: 6px; margin: 12px 0;
          font-family: monospace; font-size: 13px; overflow-x: auto;
        }
        .code-block code { color: #7ee787; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>nikcli Companion</h1>
        <p class="subtitle">Web UI for Claude Code sessions</p>
        
        <div class="card">
          <h2>Connect Claude Code</h2>
          <p style="color: #8b949e; margin-bottom: 16px;">
            Run this command to connect Claude Code to the companion:
          </p>
          <div class="code-block">
            <code>claude --sdk-url wss://${c.req.url.split("/")[2]}/ws/cli/\${SESSION_ID} --print --output-format stream-json --input-format stream-json -p ""</code>
          </div>
          <p style="color: #8b949e; font-size: 13px;">
            Replace <code>\${SESSION_ID}</code> with your session ID (e.g., using <code>crypto.randomUUID()</code>)
          </p>
        </div>
        
        <div class="card">
          <h2>Quick Connect</h2>
          <p style="color: #8b949e; margin-bottom: 16px;">
            Click below to create a new session and open the UI:
          </p>
          <button id="createSession" class="btn">Create Session</button>
        </div>
      </div>
      
      <script>
        const API_BASE = window.location.origin;
        
        document.getElementById('createSession').addEventListener('click', async () => {
          const res = await fetch(API_BASE + '/api/sessions', { method: 'POST' });
          if (!res.ok) {
            const text = await res.text();
            alert('Failed to create session: ' + (text || res.statusText));
            return;
          }
          const data = await res.json();
          if (data.sessionId) {
            window.location.href = '/?session=' + data.sessionId;
          }
        });
      </script>
    </body>
    </html>
  `)
})

app.get("/api/sessions", (c) => {
  return c.json([])
})

app.post("/api/sessions", async (c) => {
  const sessionId = crypto.randomUUID()
  return c.json({
    sessionId,
    wsUrl: `wss://${c.req.url.split("/")[2]}/ws/browser/${sessionId}`,
  })
})

app.get("/api/sessions/:id", (c) => {
  return c.json({ error: "Session not found" }, 404)
})

export default app
