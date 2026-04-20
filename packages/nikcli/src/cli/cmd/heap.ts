import { EOL } from "os"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Heap } from "../heap"

export const HeapCommand = cmd({
  command: "heap",
  describe: "show heap and process memory metrics",
  builder: (yargs: Argv) =>
    yargs.option("detailed", {
      alias: "a",
      type: "boolean",
      describe: "show all available memory metrics",
    }),
  handler: (args) => {
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
  },
})
