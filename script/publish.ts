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

// Resolve a single .tgz tarball in a directory, picking the newest if several exist.
// Passing a `*.tgz` glob to `npm publish` fails EUSAGE when it matches multiple files.
async function resolveTarball(dir: string): Promise<string> {
  const glob = new Bun.Glob("*.tgz")
  const files = await Array.fromAsync(glob.scan({ cwd: dir }))
  if (files.length === 0) {
    throw new Error(`No .tgz tarball found in ${dir}`)
  }
  if (files.length === 1) {
    return files[0]
  }
  const withTimes = await Promise.all(
    files.map(async (f) => ({ f, mtime: (await Bun.file(`${dir}/${f}`).stat()).mtimeMs })),
  )
  withTimes.sort((a, b) => b.mtime - a.mtime)
  return withTimes[0].f
}

const tags = [Script.channel]

const tasks = Object.entries(binaries).map(async ([name]) => {
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  }
  await $`bun pm pack`.cwd(`./dist/${name}`)
  const tarball = await resolveTarball(`./dist/${name}`)
  for (const tag of tags) {
    await $`npm publish ${tarball} --access public --tag ${tag}`.cwd(`./dist/${name}`)
  }
})
await Promise.all(tasks)
await $`bun pm pack`.cwd(`./dist/${pkg.name}`)
const workspaceTarball = await resolveTarball(`./dist/${pkg.name}`)
for (const tag of tags) {
  await $`npm publish ${workspaceTarball} --access public --tag ${tag}`.cwd(`./dist/${pkg.name}`)
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
