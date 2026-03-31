import { defineConfig } from "astro/config"
import cloudflare from "@astrojs/cloudflare"
import mdx from "@astrojs/mdx"
import react from "@astrojs/react"
import tailwind from "@astrojs/tailwind"

export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  integrations: [tailwind(), mdx(), react()],
  vite: {
    define: {
      global: "globalThis",
    },
  },
})
