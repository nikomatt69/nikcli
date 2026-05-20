import { defineMiddleware } from "astro:middleware"

export const onRequest = defineMiddleware(async (_context, next) => {
  // Cloudflare Pages + Astro injects env bindings into ctx.locals.runtime.env
  // Our API routes access them via: (ctx.locals as any).runtime?.env
  return next()
})
