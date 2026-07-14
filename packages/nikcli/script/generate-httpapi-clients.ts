#!/usr/bin/env bun

import { BunFileSystem } from "@effect/platform-bun"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@nikcli-ai/httpapi-codegen"
import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import { PublicHttpApi } from "../src/server/httpapi/public"

const contract = compile(PublicHttpApi.Api, {
  // WebSocket upgrade endpoint; neither generated HTTP transport owns it.
  omitEndpoints: new Set(["pty.connect"]),
})

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(contract, { mutableOutputs: true, relativeImportExtension: ".js" }),
        fileURLToPath(new URL("../../sdk/js/src/httpapi/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(contract, { module: "../../public", api: "PublicApi" }),
        fileURLToPath(new URL("../src/server/httpapi/client/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(contract, { module: "../../public", api: "PublicApi" }),
        fileURLToPath(new URL("../src/server/httpapi/client/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(BunFileSystem.layer)),
)

const endpoints = contract.groups.reduce((total, group) => total + group.endpoints.length, 0)
console.log(`Generated Promise and Effect clients for ${contract.groups.length} groups and ${endpoints} endpoints`)
