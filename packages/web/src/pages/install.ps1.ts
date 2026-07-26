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
  const version = url.searchParams.get("version")

  // `irm ... | iex` cannot pass parameters, so a pinned version is baked into
  // the served script. A param block must stay the first statement, so the
  // default is patched instead of being prepended.
  const script =
    version && /^[\w.\-]+$/.test(version)
      ? installScript.replace("$Version = $env:NIKCLI_VERSION", `$Version = "${version}"`)
      : installScript

  const headers = corsHeaders(request)
  headers.set("Content-Type", "text/plain; charset=utf-8")
  headers.set("Cache-Control", "public, max-age=3600")

  return new Response(script, { headers })
}
