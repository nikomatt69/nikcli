import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { resolve } from "path"

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "../src/ui"),
  build: {
    outDir: resolve(__dirname, "../dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "../src/ui/index.html"),
    },
  },
  server: {
    port: 5174,
  },
})
