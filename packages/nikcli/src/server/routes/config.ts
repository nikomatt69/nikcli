import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

const log = Log.create({ service: "server" })

function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
  return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
}

function runProvider<A, E>(effect: Effect.Effect<A, E, Provider.Service>) {
  return runPromiseWithLayer(Provider.defaultLayer, withCurrentInstance(effect))
}

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current Nikcli configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            return yield* service.get()
          }),
        )
        return c.json(config)
      },
    )
    .patch(
      "/",
      describeRoute({
        summary: "Update configuration",
        description: "Update Nikcli configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        await runConfig(
          Effect.gen(function* () {
            const service = yield* Config.Service
            yield* service.update(config)
          }),
        )
        return c.json(config)
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    providers: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        using _ = log.time("providers")
        const providers = await runProvider(
          Effect.gen(function* () {
            const provider = yield* Provider.Service
            const list = yield* provider.list()
            return mapValues(list, (item) => item)
          }),
        )
        return c.json({
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
        })
      },
    ),
)
