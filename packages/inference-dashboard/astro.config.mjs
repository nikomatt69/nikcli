import { defineConfig } from "astro/config"
import cloudflare from "@astrojs/cloudflare"
import solid from "@astrojs/solid-js"
import mdx from "@astrojs/mdx"
import tailwind from "@astrojs/tailwind"

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [tailwind(), mdx(), solid()],
  vite: {
    define: {
      global: "globalThis",
    },
  },
})
