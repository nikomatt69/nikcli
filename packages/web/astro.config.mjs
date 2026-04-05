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
    server: {
      proxy: {
        "/user": { target: "http://localhost:4096", changeOrigin: true },
        "/session": { target: "http://localhost:4096", changeOrigin: true },
        "/studio/api": { target: "http://localhost:4096", changeOrigin: true },
        "/global": { target: "http://localhost:4096", changeOrigin: true },
      },
    },
  },
})
