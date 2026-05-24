#!/usr/bin/env bun

import { Script } from "@nikcli-ai/script"
import { $ } from "bun"

if (!Script.preview) {
  await $`gh release edit v${Script.version} --draft=false`
}

await $`bun install`

// Download all platform archives needed for registries (homebrew, etc.)
// These must match the naming convention used by release-github.ts
await $`mkdir -p dist`
await $`gh release download v${Script.version} --pattern "nikcli-ai-linux-*64*.tar.gz" --pattern "nikcli-ai-darwin-*64*.zip" -D dist`

await import(`../packages/nikcli/script/publish-registries.ts`)
