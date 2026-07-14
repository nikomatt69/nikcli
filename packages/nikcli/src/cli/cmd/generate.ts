import { Server } from "../../server/server"
import type { CommandModule } from "yargs"

export type OpenApiSource = "hono" | "httpapi"

export function openApiSource(input: { readonly httpapi?: boolean; readonly env?: string | undefined }): OpenApiSource {
  if (input.httpapi === true) return "httpapi"
  return input.env === "httpapi" || input.env === "effect" ? "httpapi" : "hono"
}

/**
 * OpenAPI generation.
 *
 * Default: Hono `Server.openapi()` (production SDK path). The Effect
 * PublicHttpApi surface covers only the bridged route subset, so generating
 * the SDK from it drops namespaces clients depend on (path, find, lsp, auth,
 * mobile, vcs, …). Opt-in Effect: `NIKCLI_SDK_OPENAPI=httpapi` or `--httpapi`.
 * The default flips only once PublicHttpApi reaches route parity with Hono.
 */
export const GenerateCommand = {
  command: "generate",
  builder: (yargs) =>
    yargs.option("httpapi", {
      type: "boolean",
      default: false,
      describe: "Emit OpenAPI from Effect PublicHttpApi instead of Hono (opt-in; NIKCLI_SDK_OPENAPI=httpapi)",
    }),
  handler: async (args) => {
    const source = openApiSource({
      httpapi: args.httpapi === true,
      env: process.env.NIKCLI_SDK_OPENAPI,
    })

    let specs: Record<string, any>
    if (source === "httpapi") {
      const { OpenApi } = await import("effect/unstable/httpapi")
      const { PublicApi } = await import("../../server/httpapi/public")
      specs = OpenApi.fromApi(PublicApi) as Record<string, any>
      // Hono's instance-selection middleware adds optional `directory` and
      // `workspace` query parameters to every operation; mirror that here so
      // the SDK generated from either spec has identical method options.
      for (const item of Object.values((specs.paths ?? {}) as Record<string, any>)) {
        if (!item || typeof item !== "object") continue
        for (const method of ["get", "post", "put", "delete", "patch"] as const) {
          const operation = item[method]
          if (!operation) continue
          operation.parameters ??= []
          for (const name of ["directory", "workspace"]) {
            if (operation.parameters.some((p: any) => p?.name === name && p?.in === "query")) continue
            operation.parameters.push({
              name,
              in: "query",
              required: false,
              schema: { type: "string" },
            })
          }
        }
      }
    } else {
      specs = (await Server.openapi()) as Record<string, any>
    }

    const paths = specs.paths ?? {}
    for (const item of Object.values(paths) as Array<Record<string, any>>) {
      if (!item || typeof item !== "object") continue
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item[method]
        if (!operation?.operationId) continue
        operation["x-codeSamples"] = [
          {
            lang: "js",
            source: [
              `import { createNikcliClient } from "@nikcli-ai/sdk`,
              ``,
              `const client = createNikcliClient()`,
              `await client.${operation.operationId}({`,
              `  ...`,
              `})`,
            ].join("\n"),
          },
        ]
      }
    }
    const json = JSON.stringify(specs, null, 2)

    // Wait for stdout to finish writing before process.exit() is called
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(json, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
} satisfies CommandModule
