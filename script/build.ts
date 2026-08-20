#!/usr/bin/env bun

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import { $ } from "bun"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"
import { Script, signDarwinBinary } from "@nikcli-ai/script"

const singleFlag = process.argv.includes("--single")
const skipInstall = process.argv.includes("--skip-install")

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
  },
]

// See packages/nikcli/script/build.ts: the tree-sitter worker must be embedded as a
// virtual file, never handed to `entrypoints` as a real node_modules path.
const treeSitterWorker = await Bun.file(fileURLToPath(import.meta.resolve("@opentui/core/parser.worker"))).text()
const treeSitterWorkerPath = "opentui-tree-sitter-worker.js"

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // Bun 1.4 x64 is baseline-only, so there is no separate avx2 artifact.
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
// These two installs exist so a cross-platform build has every platform's
// native binaries on disk. A --single build targets the current platform only,
// whose natives the ordinary workspace install already provided — and re-running
// install here relinks node_modules with the default linker, which breaks a
// workspace installed with --linker hoisted (Windows CI): @opentui/solid's
// nested @babel/core then cannot resolve @babel/helper-compilation-targets.
if (!skipInstall && !singleFlag) {
  // `process.execPath`, not the bare name: `bun run` puts node_modules/.bin
  // first on PATH, and the `bun` npm package in the tree puts a `bun` shim
  // there. Under the hoisted linker Windows CI uses, that shim wins the lookup
  // and dies with "Bun failed to remap this bin to its proper location".
  const bun = process.execPath
  await $`${bun} install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`${bun} install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    sourcemap: "external",
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      //@ts-ignore (bun types aren't up to date)
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/nikcli`,
      execArgv: [`--user-agent=nikcli/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: {
      [treeSitterWorkerPath]: treeSitterWorker,
    },
    entrypoints: ["./src/index.ts", treeSitterWorkerPath, workerPath],
    define: {
      NIKCLI_VERSION: `'${Script.version}'`,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + treeSitterWorkerPath,
      NIKCLI_WORKER_PATH: workerPath,
      NIKCLI_CHANNEL: `'${Script.channel}'`,
      NIKCLI_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })

  await $`rm -rf ./dist/${name}/bin/tui`
  if (item.os === "darwin") await signDarwinBinary(`dist/${name}/bin/nikcli`)
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

export { binaries }
