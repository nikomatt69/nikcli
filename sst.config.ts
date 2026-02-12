/// <reference path="./.sst/platform/config.d.ts" />
/// <reference path="./sst-env.d.ts" />

export default $config({
  app(input) {
    return {
      name: "nikcli",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {
        cloudflare: {
          apiToken: process.env.CLOUDFLARE_API_TOKEN,
        },
        stripe: {
          apiKey: process.env.STRIPE_SECRET_KEY!,
        },
        supabase: {
          accessToken: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
      },
    }
  },
  async run() {
    await import("./infra/app.js")
    await import("./infra/console.js")
    await import("./infra/enterprise.js")
  },
})
