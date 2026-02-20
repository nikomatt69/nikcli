import { Hono } from "hono"
import { cors } from "hono/cors"
import { getRuntimeKey } from "hono/adapter"

const app = new Hono()

app.use("*", cors())

app.get("/", (c) => {
  const host = c.req.url.split("/")[2]?.split(":")[0] || "your-domain"

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
        .code-block {
          background: #0d1117; padding: 16px; border-radius: 6px; margin: 12px 0;
          font-family: monospace; font-size: 13px; overflow-x: auto;
        }
        code { color: #7ee787; }
        .hint { color: #8b949e; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>nikcli Companion</h1>
        <p class="subtitle">Web UI for Claude Code sessions</p>
        
        <div class="card">
          <h2>Create Session</h2>
          <button id="createSession" class="btn">Create New Session</button>
        </div>
        
        <div class="card">
          <h2>How It Works</h2>
          <p class="hint">
            1. Create a session above<br>
            2. Run Claude Code with --sdk-url pointing to this server<br>
            3. Open the UI and interact with Claude Code
          </p>
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

app.post("/api/sessions", (c) => {
  const sessionId = crypto.randomUUID()
  const host = c.req.url.split("/")[2]?.split(":")[0] || "localhost"

  return c.json({
    sessionId,
    wsUrl: `wss://${host}/ws/${sessionId}`,
    instructions: `claude --sdk-url wss://${host}/ws/${sessionId} --print --output-format stream-json --input-format stream-json -p ""`,
  })
})

app.get("/api/sessions/:id", (c) => {
  return c.json({
    id: c.req.param("id"),
    status: "waiting",
  })
})

export default app
