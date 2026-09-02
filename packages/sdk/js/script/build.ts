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
// Prettier resolves `.prettierignore` from its working directory, and this runs
// inside packages/sdk/js, so the repo-root ignore never reached it: prettier
// collapsed `.httpapi-codegen.json` onto one line, the release committed that,
// and every later codegen run rewrote it expanded — failing CI's "Generated
// HTTP client drift" gate on a diff nobody authored. Point prettier at the root
// ignore file so there is one list and it applies from any directory.
await $`bun prettier --write src/httpapi --ignore-path ${path.resolve(dir, "../../../.prettierignore")}`
await $`rm -rf dist`
await $`bun tsc`
