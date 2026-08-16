import fs from "fs"
const FILE = process.env.NIKCLI_BG_DEBUG
export function dbg(...args: unknown[]) {
  if (!FILE) return
  try {
    fs.appendFileSync(FILE, args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n")
  } catch {}
}
