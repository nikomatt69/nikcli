#!/usr/bin/env bun

// Builds the published SDK.
//
// The generated client under `src/httpapi/generated` is produced from the
// Effect contract by `packages/nikcli/script/generate-httpapi-clients.ts` — it
// is regenerated here so a release can never ship a client that has drifted
// from the contract. There is no OpenAPI round-trip and no hey-api step; the
// codegen compiles the `PublicApi` object directly.

import { $ } from "bun"
import path from "node:path"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

await $`bun run generate:httpapi-clients`.cwd(path.resolve(dir, "../../nikcli"))
await $`bun prettier --write src/httpapi`
await $`rm -rf dist`
await $`bun tsc`
