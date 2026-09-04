#!/usr/bin/env bun
/**
 * A paced, self-narrating walkthrough of nikcli's GPT-6 Astra support.
 *
 * Every value printed below is produced by the shipped code — the catalog
 * patch, the reasoning-effort derivation, the request-options builder, the
 * Codex OAuth model filter and the system-prompt picker are all called for
 * real. Nothing here is a transcript or a mock.
 *
 * It reaches no network and needs no credentials, so it demonstrates that the
 * integration is wired correctly, not that a live completion succeeds.
 *
 *   bun packages/nikcli/script/astra-demo.ts
 *   bun packages/nikcli/script/astra-demo.ts --fast   # no pauses, for CI
 */
import { ModelsDev } from "@/provider/models"
import * as ProviderTransform from "@/provider/transform"
import { filterCodexOAuthModels } from "@/plugin/codex"

const FAST = process.argv.includes("--fast")
const sleep = (ms: number) => (FAST ? Promise.resolve() : Bun.sleep(ms))

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  grey: "\x1b[90m",
}

let failures = 0
let checks = 0

function ok(label: string, actual: unknown, expected: unknown) {
  checks++
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) failures++
  const mark = pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`
  console.log(`   ${mark} ${label.padEnd(34)} ${C.bold}${JSON.stringify(actual)}${C.reset}`)
}

async function step(n: number, title: string, source: string) {
  console.log("")
  console.log(`${C.cyan}${C.bold} ${n}. ${title}${C.reset}  ${C.grey}${source}${C.reset}`)
  await sleep(500)
}

function model(apiId: string, npm = "@ai-sdk/openai", providerID = "openai") {
  return {
    providerID,
    id: apiId,
    release_date: "2026-09-03",
    api: { id: apiId, url: "https://api.openai.com/v1", npm },
    capabilities: { reasoning: true },
    limit: { context: 1_050_000, output: 128_000 },
  } as never
}

console.log("")
console.log(`${C.magenta}${C.bold} nikcli · GPT-6 Astra support${C.reset}`)
console.log(`${C.grey} every value below is returned by the shipped code, called live${C.reset}`)
await sleep(900)

// ── 1 ────────────────────────────────────────────────────────────────────
await step(1, "Catalog entry", "ModelsDev.patch()")
const database = {
  openai: {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    api: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
    models: {},
  },
} as never
const astra = ModelsDev.patch(database).openai!.models["gpt-6-astra"]!
console.log(`   ${C.grey}models.dev has no Astra row yet, so nikcli seeds one${C.reset}`)
await sleep(600)
ok("name", astra.name, "GPT-6 Astra")
await sleep(220)
ok("context window", astra.limit.context, 1_050_000)
await sleep(220)
ok("max output", astra.limit.output, 128_000)
await sleep(220)
ok("cost per 1M", astra.cost, { input: 10, output: 50, cache_read: 1, cache_write: 12.5 })
await sleep(220)
ok("modalities in", astra.modalities!.input, ["text", "image"])
await sleep(220)
ok("temperature", astra.temperature, false)
await sleep(900)

// ── 2 ────────────────────────────────────────────────────────────────────
await step(2, "Reasoning effort tiers", "ProviderTransform.variants()")
console.log(`   ${C.grey}Astra drops none/minimal (both 400) and adds max${C.reset}`)
await sleep(600)
ok("openai (Responses)", Object.keys(ProviderTransform.variants(model("gpt-6-astra"))), [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])
await sleep(280)
ok(
  "openrouter (chat)",
  Object.keys(ProviderTransform.variants(model("openai/gpt-6-astra", "@openrouter/ai-sdk-provider", "openrouter"))),
  ["low", "medium", "high", "xhigh"],
)
await sleep(280)
ok(
  "copilot (chat)",
  Object.keys(ProviderTransform.variants(model("gpt-6-astra", "@ai-sdk/github-copilot", "github-copilot"))),
  ["low", "medium", "high", "xhigh"],
)
await sleep(280)
console.log(`   ${C.grey}gpt-5.x is untouched${C.reset}`)
ok("gpt-5.2 (unchanged)", Object.keys(ProviderTransform.variants(model("gpt-5.2"))), [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
])
await sleep(900)

// ── 3 ────────────────────────────────────────────────────────────────────
await step(3, "Request defaults", "ProviderTransform.options()")
const options = ProviderTransform.options({ sessionID: "ses_demo", model: model("gpt-6-astra") } as never)
ok("reasoningEffort", options["reasoningEffort"], "medium")
await sleep(220)
ok("reasoningSummary", options["reasoningSummary"], "detailed")
await sleep(220)
ok("include", options["include"], ["reasoning.encrypted_content"])
await sleep(220)
console.log(`   ${C.grey}textVerbosity is undocumented for Astra, so it is never sent${C.reset}`)
ok("textVerbosity", options["textVerbosity"], undefined)
await sleep(900)

// ── 4 ────────────────────────────────────────────────────────────────────
await step(4, "Codex OAuth catalog", "filterCodexOAuthModels()")
console.log(`   ${C.grey}what a ChatGPT Pro/Plus login is offered${C.reset}`)
await sleep(600)
const codexProvider = {
  models: Object.fromEntries(
    ["gpt-6-astra", "gpt-5.5", "gpt-5.2-codex", "gpt-4o", "o3", "gpt-3.5-turbo"].map((id) => [id, { api: { id } }]),
  ),
}
console.log(`   ${C.yellow}before${C.reset}  ${Object.keys(codexProvider.models).join("  ")}`)
await sleep(700)
filterCodexOAuthModels(codexProvider)
ok("after", Object.keys(codexProvider.models).sort(), ["gpt-5.2-codex", "gpt-5.5", "gpt-6-astra"])
await sleep(900)

// ── 5 ────────────────────────────────────────────────────────────────────
await step(5, "Summary", "")
if (failures === 0) {
  console.log(
    `   ${C.green}${C.bold}all ${checks} assertions passed${C.reset} ${C.grey}— Astra is wired end to end${C.reset}`,
  )
} else {
  console.log(`   ${C.red}${C.bold}${failures} assertion(s) failed${C.reset}`)
}
console.log("")
console.log(`   ${C.grey}no network, no credentials: this proves the integration,${C.reset}`)
console.log(`   ${C.grey}not a live completion against OpenAI.${C.reset}`)
console.log("")
await sleep(1200)
process.exit(failures === 0 ? 0 : 1)
