import type { APIRoute } from "astro"

function shortDomain(requestURL: URL) {
  const protocol = "https:"
  const hostname = requestURL.hostname

  if (hostname === "nikcli.store") return `${protocol}//s.nikcli.store`
  if (hostname === "dev.nikcli.store") return `${protocol}//dev.s.nikcli.store`
  if (hostname.endsWith(".dev.nikcli.store")) {
    const stage = hostname.slice(0, -".dev.nikcli.store".length)
    if (stage) return `${protocol}//${stage}.dev.s.nikcli.store`
  }

  const stage = import.meta.env.SST_STAGE
  if (stage === "production") return `${protocol}//s.nikcli.store`
  if (!stage || stage === "dev") return `${protocol}//dev.s.nikcli.store`
  return `${protocol}//${stage}.dev.s.nikcli.store`
}

export const GET: APIRoute = ({ params, url }) => {
  const id = params.id
  if (!id) {
    return new Response("Missing share ID", { status: 400 })
  }

  const target = new URL(`/share/${encodeURIComponent(id)}`, shortDomain(url))
  target.search = url.search

  return Response.redirect(target.toString(), 308)
}
