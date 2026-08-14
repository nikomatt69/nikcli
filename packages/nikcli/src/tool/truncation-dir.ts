import path from "path"
import { Global } from "@nikcli-ai/util/global"

export const DIR = path.join(Global.Path.data, "tool-output")
export const GLOB = path.join(DIR, "*")

export function outputPath(id: string) {
  return path.join(DIR, id)
}
