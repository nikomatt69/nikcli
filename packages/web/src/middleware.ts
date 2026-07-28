import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware((context, next) => {
  if (context.url.pathname !== "/.llm") return next();

  const target = new URL(context.url);
  target.pathname = "/llm";
  return context.rewrite(target);
});
