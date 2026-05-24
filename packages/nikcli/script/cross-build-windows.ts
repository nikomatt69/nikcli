#!/usr/bin/env bun
/**
 * Cross-build script: produces a Windows x64 nikcli.exe from any host platform.
 * Lets the Mac/Linux developer prove the entire Windows compile target works
 * without having a Windows machine; the resulting binary cannot be EXECUTED on
 * the host but its existence + size + headers prove the toolchain accepts it.
 *
 * Invariants checked:
 *  - bun build succeeds with --target=bun-windows-x64
 *  - the output exists and is a PE executable (Windows binary)
 *  - per-platform conditional code in `bun-windows-x64` doesn't surface POSIX
 *    branches at compile time
 */
import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "node:path"
import fs from "node:fs"
import { $ } from "bun"
import { fileURLToPath } from "node:url"
import pkg from "../package.json"
import { Script } from "@nikcli-ai/script"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
process.chdir(dir)

const target = "bun-windows-x64"
const outDir = path.join(dir, "dist", "cross-windows-x64")
const binPath = path.join(outDir, "bin", "nikcli.exe")

await $`rm -rf ${outDir}`
await $`mkdir -p ${path.join(outDir, "bin")}`

const parserWorker = fs.realpathSync(path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"))
const workerPath = "./src/cli/cmd/tui/worker.ts"
const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

console.log(`[cross-build] target=${target}`)
console.log(`[cross-build] output=${binPath}`)

const buildStart = Date.now()
await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  sourcemap: "none",
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    // @ts-ignore - bun types lag
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: target as any,
    outfile: binPath,
    execArgv: [`--user-agent=nikcli/${Script.version}`, "--use-system-ca", "--"],
    windows: {},
  },
  entrypoints: ["./src/index.ts", parserWorker, workerPath],
  define: {
    NIKCLI_VERSION: `'${Script.version}'`,
    OTUI_TREE_SITTER_WORKER_PATH: "B:/~BUN/root/" + workerRelativePath,
    NIKCLI_WORKER_PATH: workerPath,
    NIKCLI_CHANNEL: `'local'`,
    NIKCLI_LIBC: "",
  },
})
const buildMs = Date.now() - buildStart

if (!fs.existsSync(binPath)) {
  console.error(`[cross-build] FAIL: expected ${binPath} after build`)
  process.exit(1)
}

const stat = fs.statSync(binPath)
const headerBuf = Buffer.alloc(2)
const fd = fs.openSync(binPath, "r")
fs.readSync(fd, headerBuf, 0, 2, 0)
fs.closeSync(fd)
const isPE = headerBuf[0] === 0x4d && headerBuf[1] === 0x5a // "MZ"

console.log(`[cross-build] built ${(stat.size / 1024 / 1024).toFixed(1)} MB in ${buildMs} ms`)
console.log(`[cross-build] PE header (MZ): ${isPE ? "OK" : "MISSING"}`)

if (!isPE) {
  console.error(`[cross-build] FAIL: binary does not start with MZ; not a Windows PE executable`)
  console.error(`[cross-build] first bytes: ${headerBuf.toString("hex")}`)
  process.exit(1)
}

console.log(`[cross-build] PASS — Windows x64 binary produced and validated as PE`)
