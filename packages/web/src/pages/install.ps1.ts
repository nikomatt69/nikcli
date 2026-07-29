import type { APIRoute } from "astro"
import installScript from "../../install.ps1?raw"

const corsHeaders = (request: Request) => {
  const headers = new Headers()
  headers.set("Access-Control-Allow-Origin", "*")
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS")
  headers.set("Access-Control-Allow-Headers", request.headers.get("Access-Control-Request-Headers") || "*")
  headers.set("Access-Control-Max-Age", "86400")
  return headers
}

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export const GET: APIRoute = async ({ url, request }) => {
  const version = url.searchParams.get("version") || undefined

  try {
    let script = installScript

    if (!script || script.trim().length === 0) {
      const fallbackUrl = new URL("/install.ps1", url)
      const fallback = await fetch(fallbackUrl)
      if (fallback.ok) {
        script = await fallback.text()
      }
    }

    // `irm ... | iex` cannot pass parameters, so ?version= is baked into the
    // env var the script already reads.
    if (version) {
      script = `$env:NIKCLI_VERSION = ${JSON.stringify(version)}\n${script}`
    }

    const headers = corsHeaders(request)
    headers.set("Content-Type", "text/plain; charset=utf-8")
    headers.set("Cache-Control", "public, max-age=3600")

    return new Response(script, { headers })
  } catch {
    const headers = corsHeaders(request)
    headers.set("Content-Type", "text/plain; charset=utf-8")
    return new Response("# Install script not found\n", { status: 404, headers })
  }
}
