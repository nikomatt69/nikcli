import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { EOL } from "os"
import { Heap } from "@/cli/heap"

export default Runtime.handler(Commands.commands["heap"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "detailed": Option.getOrUndefined(input["detailed"]),
  }
  const output = Heap.report(
    args.detailed
      ? [
          "rss",
          "heapTotal",
          "heapUsed",
          "external",
          "arrayBuffers",
          "heapLimit",
          "totalAvailableSize",
          "totalHeapSize",
          "totalPhysicalSize",
        ]
      : ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"],
  )
  console.log(output + EOL)
})
