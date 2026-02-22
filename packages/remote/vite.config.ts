import { defineConfig } from "vite"
import path from "path"

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      input: "./index.html",
      output: {
        manualChunks: {
          ghostty: ["ghostty-web"],
        },
      },
    },
    target: "es2020",
    minify: "terser",
  },
  server: {
    port: 3000,
    host: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
