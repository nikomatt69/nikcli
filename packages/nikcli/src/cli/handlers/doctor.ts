import { Option } from "effect"
import { Runtime } from "../framework/runtime"
import { passthrough } from "../framework/args"
import { Commands } from "../commands"
import { UI } from "@/cli/ui"
import { Installation } from "@/installation"
import { EOL } from "os"
import { runDoctorChecks } from "@/doctor/checks"

export default Runtime.handler(Commands.commands["doctor"], async (input) => {
  const args = {
    _: [],
    $0: "nikcli",
    "--": passthrough(),
    "json": Option.getOrUndefined(input["json"]),
  }
  const { results } = await runDoctorChecks()

  if (args.json) {
    const failures = results.filter((r) => !r.ok)
    const payload = {
      ok: failures.length === 0,
      version: Installation.VERSION,
      channel: Installation.CHANNEL,
      results,
      failures: failures.length,
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + EOL)
    process.exit(failures.length === 0 ? 0 : 1)
  }

  UI.empty()
  UI.println(UI.logo("  "))
  UI.empty()
  process.stdout.write(`nikcli doctor — ${Installation.VERSION} (${Installation.CHANNEL})${EOL}`)
  process.stdout.write("=".repeat(60) + EOL)

  let failures = 0
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗"
    const color = r.ok ? "\x1b[32m" : "\x1b[31m"
    process.stdout.write(`${color}${mark}\x1b[0m  ${r.label}`)
    if (r.detail) process.stdout.write(` — ${r.detail}`)
    process.stdout.write(EOL)
    if (!r.ok) failures++
    if (r.fix) {
      process.stdout.write(`     fix: ${r.fix}${EOL}`)
    }
  }

  process.stdout.write(EOL)
  if (failures === 0) {
    process.stdout.write(`All ${results.length} checks passed.${EOL}`)
    process.exit(0)
  } else {
    process.stdout.write(`${failures} of ${results.length} checks failed. See the \`fix:\` lines above.${EOL}`)
    process.exit(1)
  }
})
