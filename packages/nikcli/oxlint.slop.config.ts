import { defineConfig } from "oxlint"

/**
 * Anti-slop lint pass — `bun run lint:slop`.
 *
 * Deliberately **not** named `oxlint.config.ts`: that filename is
 * auto-discovered, and `lint` (which `pretest` runs before every `bun run
 * test`) must stay on the default rule set. The rules below are at full
 * `error` severity — the split is by command, not by watering them down.
 *
 * As of the first install this reports 3719 findings across 537 files, led by
 * `require-safety-comment-for-type-assertion` (1797) and `no-runtime-typeof`
 * (686). That is a migration, not a cleanup; fix them rule by rule, smallest
 * count first, and do not silence a rule to make this pass.
 *
 * `anti-slop` is a vendored local plugin (`tools/oxlint/anti-slop`), not an npm
 * dependency — it is ignored here so its own rule sources are not linted as
 * application code. The Effect group is opt-in and enabled because this package
 * depends on `effect` directly; it currently reports zero violations.
 */
export default defineConfig({
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  rules: {
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
  },
})
