import { domain } from "./stage"

const GITHUB_APP_ID = new sst.Secret("GITHUB_APP_ID")
const GITHUB_APP_PRIVATE_KEY = new sst.Secret("GITHUB_APP_PRIVATE_KEY")
export const EMAILOCTOPUS_API_KEY = new sst.Secret("EMAILOCTOPUS_API_KEY")
const ADMIN_SECRET = new sst.Secret("ADMIN_SECRET")
const DISCORD_SUPPORT_BOT_TOKEN = new sst.Secret("DISCORD_SUPPORT_BOT_TOKEN")
const DISCORD_SUPPORT_CHANNEL_ID = new sst.Secret("DISCORD_SUPPORT_CHANNEL_ID")
const FEISHU_APP_ID = new sst.Secret("FEISHU_APP_ID")
const FEISHU_APP_SECRET = new sst.Secret("FEISHU_APP_SECRET")

export const api = new sst.cloudflare.Worker("Api", {
  domain: `api.${domain}`,
  handler: "packages/function/src/api.ts",
  environment: {
    WEB_DOMAIN: domain,
  },
  url: true,
  link: [
    GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY,
    ADMIN_SECRET,
    DISCORD_SUPPORT_BOT_TOKEN,
    DISCORD_SUPPORT_CHANNEL_ID,
    FEISHU_APP_ID,
    FEISHU_APP_SECRET,
  ],
  transform: {
    worker: (args) => {
      args.logpush = true
    },
  },
})

new sst.cloudflare.x.Astro("Web", {
  domain: "docs." + domain,
  path: "packages/web",
  buildCommand: "bun turbo build --filter=@nikcli-ai/web",
  environment: {
    SST_STAGE: $app.stage,
    VITE_API_URL: api.url.apply((url) => url!),
  },
})

new sst.cloudflare.x.Astro("Website", {
  domain,
  path: "packages/web",
  buildCommand: "bun turbo build --filter=@nikcli-ai/web",
  environment: {
    SST_STAGE: $app.stage,
  },
})

new sst.cloudflare.StaticSite("WebApp", {
  domain: "app." + domain,
  path: "packages/app",
  build: {
    command: "bun run build",
    output: "dist",
  },
})
