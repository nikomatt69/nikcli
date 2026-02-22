import { build } from "bun"

await build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  splitting: false,
  sourcemap: "inline",
  target: "bun",
  format: "esm",
})
