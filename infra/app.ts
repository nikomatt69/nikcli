/// <reference path="../.sst/platform/config.d.ts" />

import { domain } from "./stage"

const GITHUB_APP_ID = new sst.Secret("GITHUB_APP_ID")
const GITHUB_APP_PRIVATE_KEY = new sst.Secret("GITHUB_APP_PRIVATE_KEY")
export const EMAILOCTOPUS_API_KEY = new sst.Secret("EMAILOCTOPUS_API_KEY")
const ADMIN_SECRET = new sst.Secret("ADMIN_SECRET")
const DISCORD_SUPPORT_BOT_TOKEN = new sst.Secret("DISCORD_SUPPORT_BOT_TOKEN")
const DISCORD_SUPPORT_CHANNEL_ID = new sst.Secret("DISCORD_SUPPORT_CHANNEL_ID")
const NIKCLI_DISCORD_WEBHOOK_URL = new sst.Secret("NIKCLI_DISCORD_WEBHOOK_URL")
const FEISHU_APP_ID = new sst.Secret("FEISHU_APP_ID")
const FEISHU_APP_SECRET = new sst.Secret("FEISHU_APP_SECRET")
const NIKCLI_FIGMA_TOKEN = new sst.Secret("NIKCLI_FIGMA_TOKEN")
const NIKCLI_GITHUB_TOKEN = new sst.Secret("NIKCLI_GITHUB_TOKEN")
const NIKCLI_SLACK_BOT_TOKEN = new sst.Secret("NIKCLI_SLACK_BOT_TOKEN")
const NIKCLI_SLACK_CHANNEL = new sst.Secret("NIKCLI_SLACK_CHANNEL")

// Durable storage for shared session JSON (survives Durable Object eviction).
const bucket = new sst.cloudflare.Bucket("Bucket")

export const api = new sst.cloudflare.Worker("Api", {
  domain: `api.${domain}`,
  handler: "packages/function/src/api.ts",
  environment: {
    WEB_DOMAIN: domain,
  },
  url: true,
  link: [
    bucket,
    GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY,
    ADMIN_SECRET,
    DISCORD_SUPPORT_BOT_TOKEN,
    DISCORD_SUPPORT_CHANNEL_ID,
    NIKCLI_DISCORD_WEBHOOK_URL,
    FEISHU_APP_ID,
    FEISHU_APP_SECRET,
    NIKCLI_FIGMA_TOKEN,
    NIKCLI_GITHUB_TOKEN,
    NIKCLI_SLACK_BOT_TOKEN,
    NIKCLI_SLACK_CHANNEL,
  ],
  transform: {
    worker: (args) => {
      if (process.env.CLOUDFLARE_ENABLE_LOGPUSH === "1") {
        args.logpush = true
      }
      // Bind the share/sync Durable Object (one instance per shared session).
      args.bindings = $resolve(args.bindings).apply((bindings) => [
        ...bindings,
        {
          name: "SYNC_SERVER",
          type: "durable_object_namespace",
          className: "SyncServer",
        },
      ])
      // First migration for the brand-new SQLite-backed DO class.
      args.migrations = {
        newTag: "v1",
        newSqliteClasses: ["SyncServer"],
      }
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

new sst.cloudflare.Worker("Companion", {
  domain: `companion.${domain}`,
  handler: "packages/companion/src/server/worker.ts",
  url: true,
})
