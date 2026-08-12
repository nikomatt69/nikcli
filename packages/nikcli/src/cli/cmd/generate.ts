import type { CommandModule } from "yargs"

export const GenerateCommand = {
  command: "generate",
  handler: async () => {
    const { OpenApi } = await import("effect/unstable/httpapi")
    const { PublicApi } = await import("../../server/httpapi/public")
    const specs = OpenApi.fromApi(PublicApi) as Record<string, any>
    // Instance selection is transport middleware rather than endpoint input.
    // Keep these options in the public contract for SDK compatibility.
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
