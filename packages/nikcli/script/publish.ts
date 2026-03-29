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

async function npmPublish(cwd: string, tag: string) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await $`npm publish *.tgz --access public --tag ${tag}`.cwd(cwd)
      return
    } catch (err: any) {
      const msg = String(err) + String(err?.stderr ?? "")
      if (msg.includes("previously published versions")) {
        console.log(`[${cwd}] already published at this version, skipping`)
        return
      }
      if (!msg.includes("E429") || attempt === 5) throw err
      const delay = attempt * 30000
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
  await Bun.sleep(3000)
}

for (const tag of tags) {
  await $`bun pm pack`.cwd(`./dist/${pkg.name}`)
  await npmPublish(`./dist/${pkg.name}`, tag)
}

if (!Script.preview) {
  // Create archives for GitHub release
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }

  const image = "ghcr.io/nikomatt69/nikcli"
  const platforms = "linux/amd64,linux/arm64"
  const tags = [`${image}:${Script.version}`, `${image}:latest`]
  const tagFlags = tags.flatMap((t) => ["-t", t])
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
}
