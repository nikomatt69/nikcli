#!/usr/bin/env bun

import { Script } from "@nikcli-ai/script"
import { $ } from "bun"

if (!Script.preview) {
  await $`gh release edit v${Script.version} --draft=false`
}

await $`bun install`

await $`gh release download --pattern "nikcli-linux-*64.tar.gz" --pattern "nikcli-darwin-*64.zip" -D dist`

await import(`../packages/nikcli/script/publish-registries.ts`)
