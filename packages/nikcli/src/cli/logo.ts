import { Log } from "@/util/log"

const log = Log.create({ service: "logo" })

const LOGO: [string, string][] = [
  [
    `
    ███╗   ██╗ ██╗ ██╗  ██╗  ██████╗ ██╗      ██╗
    ████╗  ██║ ██║ ██║ ██╔╝ ██╔════╝ ██║      ██║`,
    `
    ██╔██╗ ██║ ██║ █████╔╝  ██║      ██║      ██║
    ██║╚██╗██║ ██║ ██╔═██╗  ██║      ██║      ██║
    ██║ ╚████║ ██║ ██║  ██╗ ╚██████╗ ███████╗ ██║
    ╚═╝  ╚═══╝ ╚═╝ ╚═╝  ╚═╝  ╚═════╝ ╚══════╝ ╚═╝

                              ◇`,
  ],
]

export function logo(pad?: string): string {
  const result: string[] = []

  for (const [firstPart, secondPart] of LOGO) {
    if (pad) {
      result.push(pad)
    }
    result.push(Bun.color("gray", "ansi") ?? "")
    result.push(firstPart)
    result.push("\x1b[0m")
    result.push(secondPart)
    result.push("\n")
  }

  const output = result.join("").trimEnd()
  log.debug("Logo rendered", { hasPad: Boolean(pad) })
  return output
}
