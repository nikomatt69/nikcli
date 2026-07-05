import { Log } from "@/util/log"

const log = Log.create({ service: "logo" })
const GITHUB_PROFILE_URL = "https://github.com/nikomatt69"
const CREDIT = `\x1b[94m\x1b]8;;${GITHUB_PROFILE_URL}\x07by nikomatt69\x1b]8;;\x07\x1b[0m`

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

                    
                    ◇ ${CREDIT}`,
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
