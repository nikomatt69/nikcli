import { Option } from "effect"
import { Runtime } from "../../framework/runtime"
import { passthrough } from "../../framework/args"
import { Commands } from "../../commands"
import { startMobileHost, stopMobileHost } from "./shared"

export default Runtime.handler(Commands.commands["mobile"].commands["serve"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    port: input["port"],
    hostname: input["hostname"],
    mdns: input["mdns"],
    cors: [...input["cors"]],
    "public-url": Option.getOrUndefined(input["public-url"]),
    publicUrl: Option.getOrUndefined(input["public-url"]),
    pair: input["pair"],
    "pair-name": input["pair-name"],
    pairName: input["pair-name"],
    "pair-expiry-days": Option.getOrUndefined(input["pair-expiry-days"]),
    pairExpiryDays: Option.getOrUndefined(input["pair-expiry-days"]),
  }
  const host = await startMobileHost({
    ...args,
    // SAFETY: the builder declares `publicUrl` as `type: "string"`,
    // so yargs yields a string or leaves it absent.
    publicUrl: args.publicUrl as string | undefined,
    pair: Boolean(args.pair),
    pairName: String(args.pairName || "iphone"),
    pairExpiryDays: args.pairExpiryDays ? Number(args.pairExpiryDays) : undefined,
    directory: process.cwd(),
  })

  await new Promise(() => {})

  await stopMobileHost(host)
})
