#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@nikcli-ai/script"
import path from "node:path"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  const name = `${pkg.name}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/nikcli --version`)
  await $`./dist/${name}/bin/nikcli --version`
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      bin: {
        nikcli: "./bin/nikcli",
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tags = [Script.channel]

function getStderr(err: any): string {
  const s = err?.stderr
  if (!s) return ""
  if (s instanceof Uint8Array) return Buffer.from(s).toString()
  return String(s)
}

async function npmPublish(cwd: string, tag: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await $`npm publish *.tgz --access public --tag ${tag}`.cwd(cwd)
      return
    } catch (err: any) {
      const stderr = getStderr(err)
      const msg = String(err?.message ?? err) + stderr
      if (stderr.includes("previously published versions") || msg.includes("previously published versions")) {
        console.log(`[${cwd}] already published at this version, skipping`)
        return
      }
      const isRateLimit = stderr.includes("E429") || msg.includes("E429")
      if (!isRateLimit || attempt === 5) throw err
      const delay = attempt * 60000
      console.log(`[${cwd}] rate limited, retry ${attempt}/5 in ${delay / 1000}s...`)
      await Bun.sleep(delay)
    }
  }
}

for (const [name] of Object.entries(binaries)) {
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  }
  await $`bun pm pack`.cwd(`./dist/${name}`)

  // Every platform package must reach npm: they are the optionalDependencies of
  // nikcli-ai, and bin/nikcli resolves the binary out of them. Skipping any of
  // them ships a main package whose optional deps do not exist, so npm silently
  // installs nothing and the CLI dies with "failed to install the right version".
  for (const tag of tags) {
    await npmPublish(`./dist/${name}`, tag)
  }

  await Bun.sleep(15000)
}

for (const tag of tags) {
  await $`bun pm pack`.cwd(`./dist/${pkg.name}`)
  await npmPublish(`./dist/${pkg.name}`, tag)
}

if (!Script.preview) {
  // Same layout as historical GH assets (e.g. 0.0.11): archive root is <triplet>/bin/nikcli (installer fallback path).
  const distDir = path.join(dir, "dist")
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar --format=ustar --no-xattrs --exclude='._*' --exclude='.DS_Store' -czf ${key}.tar.gz ${key}`
        .cwd(distDir)
        .env({ ...process.env, COPYFILE_DISABLE: "1" })
    } else {
      const zipPath = path.join(distDir, `${key}.zip`)
      await $`zip -Xrq ${zipPath} ${key} -x '*/._*' '*/.DS_Store'`
        .cwd(distDir)
        .env({ ...process.env, COPYFILE_DISABLE: "1" })
    }
  }

  const image = "ghcr.io/nikomatt69/nikcli"
  const platforms = "linux/amd64,linux/arm64"
  const tags = [`${image}:${Script.version}`, `${image}:latest`]
  const tagFlags = tags.flatMap((t) => ["-t", t])
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
}
