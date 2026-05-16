#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@nikcli-ai/script"
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
      name: pkg.name + "-ai",
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
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
  for (const tag of tags) {
    await npmPublish(`./dist/${name}`, tag)
  }
  await Bun.sleep(15000)
}

for (const tag of tags) {
  await $`bun pm pack`.cwd(`./dist/${pkg.name}`)
  await npmPublish(`./dist/${pkg.name}`, tag)
}

console.log(`\nPublished nikcli-ai@${Script.version} to npm`)
