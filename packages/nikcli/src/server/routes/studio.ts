import { Hono } from "hono"
import { readFileSync, existsSync, realpathSync } from "fs"
import { join, extname } from "path"

const STUDIO_UI_DIST = join(import.meta.dir, "../../../../studio/dist")
const STUDIO_TARGET = "http://localhost:4201"

function getStudioHtml(): string {
  const indexPath = join(STUDIO_UI_DIST, "index.html")
  if (existsSync(indexPath)) {
    return readFileSync(indexPath, "utf-8")
  }
  return `<!DOCTYPE html>
<html>
<head>
  <title>nikcli Studio</title>
  <meta charset="utf-8">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0a0a0b;color:#f4f4f5;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center}
    .msg{padding:24px;max-width:480px}
    h1{font-size:24px;margin-bottom:12px;color:#22d3ee}
    p{font-size:14px;color:#71717a;margin-bottom:8px}
    code{background:#13131a;padding:2px 8px;border-radius:4px;font-size:13px;color:#22d3ee}
    a{color:#22d3ee}
  </style>
</head>
<body>
  <div class=msg>
    <h1>nikcli Studio</h1>
    <p>Studio UI not found. Build it first:</p>
    <p><code>cd packages/studio && bun run build</code></p>
    <p>Or run standalone: <code>bun run packages/studio/src/server/index.ts</code></p>
    <p style="margin-top:16px;font-size:12px">Embedded at: <a href="/studio">/studio</a></p>
  </div>
</body>
</html>`
}

async function proxyToStudio(c: any) {
  const url = new URL(c.req.url)
  const targetUrl = `${STUDIO_TARGET}${url.pathname}${url.search}`
  const headers: Record<string, string> = {}
  c.req.headers.forEach((value: string, key: string) => {
    if (key.toLowerCase() !== "host") headers[key] = value
  })
  let body: undefined | BodyInit
  const method = c.req.method
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    try {
      body = await c.req.raw.clone().text()
    } catch {}
  }
  try {
    const res = await fetch(targetUrl, { method, headers, body, redirect: "manual" })
    const resBody = await res.text()
    return new Response(resBody, {
      status: res.status,
      headers: res.headers,
    })
  } catch {
    return c.json({ error: "Studio server not running. Start with: bun run packages/studio/src/server/index.ts" }, 503)
  }
}

export function StudioRoutes() {
  const app = new Hono()

  app.use("/studio/*", async (c, next) => {
    c.res.headers.set("Access-Control-Allow-Origin", "*")
    c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD")
    c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
    if (c.req.method === "OPTIONS") return c.body(null, 204)
    return next()
  })

  app.all("/studio/api/*", (c) => proxyToStudio(c))

  // Serve built static assets (CSS, JS, images, etc.)
  app.get("/studio/assets/*", async (c) => {
    const relativePath = c.req.path.replace(/^\/studio\//, "")
    const filePath = join(STUDIO_UI_DIST, relativePath)
    if (!existsSync(filePath)) return c.notFound()
    try {
      const realPath = realpathSync(filePath)
      if (!realPath.startsWith(STUDIO_UI_DIST)) return c.notFound()
    } catch {
      return c.notFound()
    }
    const ext = extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".ttf": "font/ttf",
      ".ico": "image/x-icon",
    }
    const contentType = mimeTypes[ext] || "application/octet-stream"
    return new Response(Bun.file(filePath), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  })

  app.get("/studio", (c) => c.html(getStudioHtml()))
  app.get("/studio/*", (c) => c.html(getStudioHtml()))

  return app
}
