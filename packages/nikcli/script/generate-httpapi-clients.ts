#!/usr/bin/env bun

import { BunFileSystem } from "@effect/platform-bun"
import {
  compile,
  emitEffectImported,
  emitEffectShape,
  emitPromise,
  emitPromiseCompat,
  write,
} from "@nikcli-ai/httpapi-codegen"
import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import { PublicClientCompat } from "../src/server/httpapi/client-compat"
import { PublicApi } from "../src/server/httpapi/public"

// WebSocket upgrade endpoints: no generated HTTP transport owns them.
const upgrades = ["pty-connect.connect", "mobile.ptyConnect"]

// Union payloads. The Promise transport passes them through untouched, but
// `HttpApiClient.ForApi` narrows a union payload to its first member, so the
// Effect clients cannot express these until the upstream derivation is fixed.
const unionPayloads = ["auth.set", "session.partUpdate"]

// OpenApi.Identifier annotations pin operationIds to the Hono OpenAPI contract
// (dotted ids that collide as client paths); keep client method names derived
// from the Effect endpoint names instead.
const shared = { clientPathsFromEndpointNames: true } as const

const promiseContract = compile(PublicApi, {
  ...shared,
  omitEndpoints: new Set(upgrades),
})
const effectContract = compile(PublicApi, {
  ...shared,
  omitEndpoints: new Set([...upgrades, ...unionPayloads]),
})
const promise = emitPromise(promiseContract, {
  mutableOutputs: true,
  relativeImportExtension: ".js",
})
const compat = emitPromiseCompat(promiseContract, PublicClientCompat, {
  typesModule: "../compat",
  relativeImportExtension: ".js",
})

await Effect.runPromise(
  Effect.all(
    [
      write(
        {
          operations: promise.operations,
          files: [...promise.files, ...compat.files],
        },
        fileURLToPath(new URL("../../sdk/js/src/httpapi/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../public",
          api: "PublicApi",
        }),
        fileURLToPath(new URL("../src/server/httpapi/client/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          module: "../../public",
          api: "PublicApi",
        }),
        fileURLToPath(new URL("../src/server/httpapi/client/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(BunFileSystem.layer)),
)

const count = (contract: typeof promiseContract) =>
  contract.groups.reduce((total, group) => total + group.endpoints.length, 0)
console.log(
  `Generated Promise client (${promiseContract.groups.length} groups, ${count(promiseContract)} endpoints)` +
    ` and Effect clients (${effectContract.groups.length} groups, ${count(effectContract)} endpoints)`,
)
