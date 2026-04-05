import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { resolve } from "path"

const root = resolve(__dirname, "src/ui")

export default defineConfig({
  plugins: [solid()],
  root,
  base: "/studio/",
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, "index.html"),
    },
  },
  resolve: {
    alias: {
      "~": resolve(root),
    },
  },
  server: {
    port: 4200,
    proxy: {
      "/studio/api": {
        target: "http://localhost:4201",
        changeOrigin: true,
      },
      "/user": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
    },
  },
})
