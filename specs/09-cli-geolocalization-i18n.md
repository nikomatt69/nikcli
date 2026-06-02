# CLI Geolocalization & Localization (i18n) — Implementation Plan

> **Scope:** `packages/nikcli/` only. Brings the CLI to parity with `packages/app` / `packages/ui`
> (which already ship `useLanguage().t()` + `en.ts`/`zh.ts` dictionaries — see `specs/06-app-i18n-audit.md`,
> `specs/07-ui-i18n-audit.md`), and adds the **new** capability the app does not have: **geolocation-driven
> auto-selection** of language, region, timezone, and currency.
>
> **Goal:** when nikcli runs anywhere in the world it should (a) detect the user's country/locale with zero
> configuration, (b) render its own UI in the right language, (c) format dates/numbers/currency for that
> region, and (d) instruct the LLM to reply in the user's language — all overridable and privacy-respecting.
>
> Date: 2026-06-02

---

## 0. Design principles

1. **Detect locally first, network last.** Country/locale resolution must never block startup and must work
   fully offline. Network GeoIP is an opt-in, cached, best-effort enrichment only.
2. **Privacy by default.** No IP ever leaves the machine unless the user opts in. The geo lookup is consent-gated
   and the result is cached locally so it runs at most once per TTL.
3. **Explicit always wins.** Resolution is a strict priority chain (config → flag → env → Intl → cached geo →
   fallback). The user can pin any axis (`language`, `region`, `timezone`, `currency`) independently.
4. **Reuse, don't reinvent.** Mirror the `app` i18n shape (`t(key, params)`, flat dot-keyed dictionaries,
   dictionary-parity test) so translations and tooling stay consistent across packages.
5. **Two distinct outputs of "locale".** (a) _Our own UI strings_ (i18n catalog) and (b) _the LLM's reply
   language_ (system-prompt instruction). They share the resolved locale but are wired separately.
6. **Incremental adoption.** Ship the resolver + LLM-language win first (highest leverage, lowest cost), then
   migrate UI strings file-by-file behind the same `t()` so nothing regresses.

---

## 1. Current state (verified)

| Concern                      | Status in `packages/nikcli`                                                                    | Evidence                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| UI string i18n               | **None** — all CLI/TUI copy is hardcoded English                                               | grep of `src/cli/cmd/**`                                       |
| Locale formatting helper     | Partial — `Locale` namespace, but `toLocaleString` with no explicit locale + hardcoded `K`/`M` | `src/util/locale.ts`                                           |
| Currency/number formatting   | Hardcoded `new Intl.NumberFormat("en-US", { currency: "USD" })` in ~8 TUI files                | `app.tsx:219`, `dialog-usage.tsx:14`, `prompt/index.tsx:89`, … |
| Country / geo detection      | **None**                                                                                       | no `geoip`/`ipapi`/`country` refs in `package.json`            |
| Config locale field          | **None**                                                                                       | `Config.Info` schema, `config.ts:1258`                         |
| LLM reply-language control   | **None** — `<env>` block has cwd/platform/date only                                            | `src/session/system.ts:63` `environmentImpl`                   |
| App/UI i18n (reference impl) | **Mature** — `useLanguage().t()`, `en.ts`/`zh.ts`, 373 keys, parity test                       | `specs/06`, `specs/07`                                         |

**Implication:** we are adding three new subsystems (Geo resolver, Locale service, i18n catalog) and wiring them
into four existing seams (Config schema, `environmentImpl`, the `Intl` formatting call-sites, and the CLI/TUI
command surface).

---

## 2. Target architecture

```
                 ┌────────────────────────────────────────────────────┐
                 │  Locale.Service  (Effect service, src/locale/)      │
                 │  resolve() -> ResolvedLocale {                      │
                 │     language   "it"      (BCP-47 primary subtag)    │
                 │     region     "IT"      (ISO-3166 country)         │
                 │     locale     "it-IT"   (full BCP-47 tag)          │
                 │     timezone   "Europe/Rome"                        │
                 │     currency   "EUR"                                │
                 │     source     "env" | "intl" | "geoip" | "config"  │
                 │     confidence "high" | "low"                       │
                 │  }                                                  │
                 └───────────┬───────────────────────┬────────────────┘
        resolution chain     │                       │  feeds
   (priority, first wins)    │                       │
   1. config.locale.* ───────┤            ┌──────────▼─────────┐  ┌─────────────────────┐
   2. --locale / --region ───┤            │ i18n catalog       │  │ environmentImpl()   │
   3. LANG/LC_*/LANGUAGE ────┤            │ t(key, params)     │  │  <env> + reply-lang │
   4. Intl.resolvedOptions ──┤            │ src/locale/i18n/   │  │  instruction        │
   5. Geo.lookup() (opt-in) ─┤            │  en.ts / it.ts ... │  └─────────────────────┘
   6. fallback en-US/US ─────┘            └────────────────────┘
                 ▲
                 │
   ┌─────────────┴───────────────┐
   │ Geo.Service (src/geo/)      │   opt-in, cached, offline-safe
   │  country from CDN GeoIP     │   provider chain w/ timeout + fallback
   └─────────────────────────────┘
```

---

## 3. Workstreams & tasks

### WS-1 — Geo detection service (`src/geo/`) _(new)_

The country/timezone resolver. Network is optional and gated.

- **`src/geo/geo.ts`** — `Geo.Service` (Effect `Context.Service`), mirroring the shape of `src/account/` services.
  - `detectLocal(): Effect<LocalSignals>` — pure, offline, no I/O beyond env + `Intl`:
    - `Intl.DateTimeFormat().resolvedOptions().{timeZone, locale}`
    - `process.env.LANG / LC_ALL / LC_MESSAGES / LANGUAGE / LANG`
    - `process.env.TZ`
    - Derive country guess from timezone (`Europe/Rome → IT`) via a small `timezone→country` table
      (bundled, ~300 zones; no dep) and from the `LANG` region subtag.
  - `lookupRemote(): Effect<GeoIP | null>` — **opt-in**, behind `config.locale.geoip !== false` AND a
    one-time consent prompt. Provider chain with per-call timeout (≤1.5s) and graceful fallback:
    1. Cloudflare trace (`https://www.cloudflare.com/cdn-cgi/trace` → `loc=IT`) — no key, just country.
    2. `https://ipapi.co/json/` — country + region + currency + timezone (fallback).
    3. Give up → `null`. Never throws to the caller.
  - `resolveCountry(): Effect<{ country, source, confidence }>` — orchestrates local → cached → remote.
- **`src/geo/cache.ts`** — persist the geo result under the global data dir (reuse `config/paths.ts`)
  with a TTL (default 7 days) so the network call runs at most once/week. Cache key includes a coarse
  network fingerprint (default gateway hash) so moving country invalidates it. Follow the existing
  `connectors/cache.ts` pattern.
- **`src/geo/tz-country.ts`** — generated `timezone → ISO-3166` map. Generation script in `script/`
  derives it from `Intl.supportedValuesOf('timeZone')` + a static seed; checked in (no runtime dep).
- **`src/geo/index.ts`** — barrel export.

**Acceptance:** `Geo.Service.resolveCountry()` returns a country with `source:"intl"` offline in <5ms; with
opt-in enabled and network present, upgrades to `source:"geoip"`, `confidence:"high"`, and caches.

---

### WS-2 — Locale resolver service (`src/locale/`) _(new — supersedes part of `util/locale.ts`)_

Single source of truth for "what locale are we in". Consumes Geo; consumed by everything else.

- **`src/locale/locale.ts`** — `Locale.Service` implementing the priority chain from §2. Pure given inputs;
  Geo is injected so it can be mocked in tests.
  - `resolve(): Effect<ResolvedLocale>` — memoized per process; re-resolves on config change event
    (subscribe to the existing `server/event` bus used by `Config`).
  - `set(partial: Partial<LocaleConfig>): Effect<void>` — persists overrides to global config.
  - Helpers (locale-aware, replacing the `en-US`-hardcoded ones): `formatNumber`, `formatCurrency`,
    `formatDate`, `formatRelative`, `formatList` — thin wrappers over `Intl.*` seeded with the resolved
    `locale`/`currency`.
- **Migrate `src/util/locale.ts`**: keep the pure string utils (`truncate`, `pluralize`, `titlecase`) where
  they are, but route `time/datetime/number` through the resolved locale instead of `undefined`/hardcoded
  thresholds. Keep the namespace name to avoid churn; add a `Locale.format.*` surface.

**Acceptance:** every formatting call-site can ask `Locale.Service` for the active `locale`/`currency`;
default (no config, US env) yields identical output to today (`en-US`, `USD`) — zero visible regression.

---

### WS-3 — Config schema (`src/config/config.ts`) _(extend)_

Add a top-level `locale` object to `Config.Info` (alongside `theme`, `model`, etc. at `config.ts:1258`),
fully optional with sensible auto-detect default. Zod, with `.describe()` for the JSON schema:

```ts
locale: z
  .object({
    language: z.string().optional().describe("UI + reply language as BCP-47 primary subtag, e.g. 'it', 'en'"),
    region:   z.string().optional().describe("ISO-3166 country code, e.g. 'IT', 'US'"),
    locale:   z.string().optional().describe("Full BCP-47 tag, e.g. 'it-IT'; overrides language+region"),
    timezone: z.string().optional().describe("IANA timezone, e.g. 'Europe/Rome'"),
    currency: z.string().optional().describe("ISO-4217 code, e.g. 'EUR'; default derived from region"),
    autoDetect: z.boolean().optional().default(true).describe("Auto-detect locale from env/system"),
    geoip:    z.boolean().optional().default(false).describe("Allow opt-in network GeoIP country lookup"),
    replyLanguage: z
      .union([z.boolean(), z.string()])
      .optional()
      .describe("Instruct the model to reply in the user's language. true=use resolved language, or a fixed tag, false=off"),
  })
  .optional()
  .describe("Localization: UI language, region, formatting, and model reply language"),
```

- Update the generated JSON schema artifact (run the existing schema-gen step; do **not** hand-edit any
  `*.gen.*` — per repo rule).
- Wire `Config.defaultLayer` so `Locale`/`Geo` can read it (they already depend on `Config.Service`).

**Acceptance:** `nikcli config` round-trips the new fields; invalid codes are rejected by zod with a clear error.

---

### WS-4 — LLM reply-language injection (`src/session/system.ts`) _(extend — highest leverage)_

This is the cheapest, highest-impact change: teach the model the user's locale so answers come back in the
right language with region-aware conventions. Extend `environmentImpl` (`system.ts:63`):

```ts
async function environmentImpl(ctx: InstanceContext) {
  const loc = await resolveLocale(ctx) // via Locale.Service
  const env = [
    `<env>`,
    `  Working directory: ${ctx.directory}`,
    `  Workspace root folder: ${ctx.worktree}`,
    `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
    `  Platform: ${process.platform}`,
    `  Today's date: ${loc.formatDate(new Date())}`, // locale-aware
    `  User locale: ${loc.locale}`,
    `  User region: ${loc.region}`,
    `  User timezone: ${loc.timezone}`,
    `</env>`,
  ]
  const parts = [env.join("\n")]
  if (loc.replyLanguage) {
    parts.push(
      `<language>\nThe user's language is ${loc.languageName} (${loc.language}). ` +
        `Unless they write to you in another language or explicitly ask otherwise, respond in ${loc.languageName}. ` +
        `Keep code, identifiers, file paths, CLI commands, and technical terms in their original form.\n</language>`,
    )
  }
  return parts
}
```

- `replyLanguage` resolution: `config.locale.replyLanguage` if set, else default **on** when a non-English
  locale is detected with `confidence:"high"`, else off (avoid forcing language on ambiguous signals).
- Keep it provider-agnostic — it's a system block appended for all models (anthropic/gpt/gemini), same as the
  existing `<env>`.

**Acceptance:** with `it-IT` resolved, the model is instructed to reply in Italian; English/code unaffected;
toggling `config.locale.replyLanguage=false` removes the block.

---

### WS-5 — i18n catalog for CLI/TUI strings (`src/locale/i18n/`) _(new + migration)_

Mirror the proven `packages/app` shape so tooling and contributor muscle-memory transfer.

- **`src/locale/i18n/index.ts`** — `t(key: string, params?: Record<string, string|number>): string`.
  - Loads the active dictionary from the resolved language; falls back per-key to `en` (never blank).
  - Supports `{name}` interpolation and a `count`-based plural helper (reuse `Locale.pluralize`).
  - Synchronous after a one-time async load at boot (dictionaries are static TS, tree-shakeable).
- **`src/locale/i18n/en.ts`** — the canonical dictionary (source of truth, flat dot-keys:
  `auth.login.success`, `models.empty`, …). Seeded by extracting current hardcoded strings.
- **`src/locale/i18n/it.ts`, `…/zh.ts`** — initial non-English locales (it + zh to match app; more added later).
- **`src/locale/i18n/parity.test.ts`** — fail CI if any locale is missing/has extra keys vs `en` (same check
  app uses; `specs/06` confirms parity testing is the standard here).
- **TUI access**: provide a `useT()` hook (thin context over the loaded catalog) so OpenTUI components call
  `t("…")` exactly like app's `useLanguage().t()`. Place context in `src/cli/cmd/tui/context/`.

**Migration (incremental, per file — non-blocking for the rest of the plan):**

1. Generate `en.ts` by extracting strings; replace literals with `t("key")` file-by-file.
2. Priority order (mirror `specs/06`): auth flow → onboarding dialog → command palette → status/usage/help
   dialogs → error messages → tips/footer hints. Each file is a self-contained PR-sized change.
3. Keep technical identifiers (MCP, LSP, URLs, model IDs, keycaps like `ESC`) untranslated by policy.

**Acceptance:** `en` parity test green; switching `config.locale.language=it` renders migrated surfaces in
Italian; unmigrated surfaces stay English (no crash, graceful fallback).

---

### WS-6 — Locale-aware formatting call-site migration _(refactor)_

Replace the ~8 hardcoded `new Intl.NumberFormat("en-US", { currency: "USD" })` instances with the
`Locale.Service` formatters from WS-2.

- Files: `cli/cmd/tui/app.tsx:219`, `feature-plugins/sidebar/context.tsx:7`, `component/dialog-analytics.tsx:42`,
  `component/dialog-usage.tsx:14`, `component/dialog-opentui-viz.tsx:196`, `component/prompt/index.tsx:89`,
  `routes/session/sidebar.tsx:57`, `routes/session/subagent-footer.tsx:47`.
- **Important caveat:** money values are USD-denominated billing amounts. Localize the _number formatting_
  (separators, grouping) per locale, but **keep currency = USD** for billing unless we genuinely bill in local
  currency. Add `Locale.formatMoneyUSD()` (locale grouping, fixed USD symbol) vs `Locale.formatCurrency()`
  (region currency) so we don't mislead users about what they're charged.
- Route `Locale.number()` (the `K`/`M` abbreviator) through `Intl` with the resolved locale.

**Acceptance:** EUR-locale user sees `1.234,56 $` style grouping with USD still the unit; US user unchanged.

---

### WS-7 — CLI command & flag surface

Give users explicit control and visibility.

- **Global flag** `--locale <tag>` (and `--region`, `--language`) parsed in `cli/network.ts`-style option
  helper or the root yargs setup; highest non-config priority in the chain (§2 step 2).
- **`nikcli locale`** command (`src/cli/cmd/locale.ts`, follow `cli/cmd/models.ts` shape):
  - `nikcli locale` — print resolved locale + source + confidence + each axis and where it came from.
  - `nikcli locale set --language it --region IT` — persist overrides to global config.
  - `nikcli locale detect` — force a fresh detect (incl. opt-in GeoIP w/ consent prompt), show result, cache it.
  - `nikcli locale reset` — clear overrides, return to auto-detect.
- **TUI**: `/locale` slash command + a picker dialog (`dialog-locale.tsx`, model after `dialog-themes`)
  listing available UI languages and letting the user set region/timezone; register in the command palette
  (`app.tsx`) and document in the help dialog.
- **First-run consent**: during onboarding (`dialog-onboarding.tsx`), if a non-English locale is detected, ask
  "Use {Italiano}? You can change this anytime with /locale" and, separately, ask the one-time GeoIP opt-in
  ("Improve country detection by a one-time network lookup? Your IP is not stored.").

**Acceptance:** `nikcli locale` shows the full resolution; `--locale` overrides for one run; `/locale` switches
the live TUI language without restart.

---

## 4. Privacy & consent (explicit)

- GeoIP is **off by default** (`config.locale.geoip=false`). It only runs after an explicit one-time opt-in and
  only sends the request implied by the chosen provider (no extra payload).
- The cached geo result stores **country/region/timezone only** — never the raw IP.
- A `NIKCLI_NO_GEOIP=1` env and `--no-geoip` flag hard-disable network lookup regardless of config.
- Offline / air-gapped machines get full functionality from local signals; the network path is purely additive.
- Document this in `SECURITY.md` and the `locale` command help.

---

## 5. Testing strategy

- **Geo unit** (`src/geo/*.test.ts`): timezone→country mapping; env parsing (`LANG=it_IT.UTF-8` → `it`/`IT`);
  remote provider parsing with mocked fetch; timeout → null fallback; cache TTL + fingerprint invalidation.
- **Locale resolver** (`src/locale/*.test.ts`): full priority chain — assert config beats flag beats env beats
  Intl beats geo beats fallback; partial overrides (pin only `currency`); memoization + re-resolve on config event.
- **i18n parity** (`parity.test.ts`): every locale has exactly `en`'s key set (CI-gating).
- **Formatting** (`src/locale/format.test.ts`): `it-IT` vs `en-US` number/date/currency snapshots; USD-money
  caveat (grouping localized, unit stays `$`).
- **System prompt** (`src/session/system.test.ts`): `<env>` includes locale; `<language>` block present iff
  `replyLanguage`; absent for English/low-confidence.
- **No-network integration**: set offline + `geoip=false`, assert resolve succeeds with `source:"intl"`.
- Use `bun run typecheck` (project uses `tsgo`) and the repo test runner.

---

## 6. Rollout / phasing (dependency-ordered)

| Phase     | Deliverable                                                                              | Depends on          | Value                                                                               |
| --------- | ---------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| **P1** ✅ | WS-3 config schema + WS-2 resolver (env/Intl only, no network) + WS-4 LLM reply-language | —                   | **Immediate**: model replies in user's language with zero network and zero UI churn |
| **P2**    | WS-1 Geo service (local tz→country) + cache; upgrade resolver confidence                 | P1                  | Accurate region offline; powers currency/date defaults                              |
| **P3** 🟡 | WS-7 `nikcli locale` command + per-run env override + `/locale` TUI picker + consent     | P1, P2              | User control & visibility                                                           |
| **P4**    | WS-1 opt-in GeoIP enrichment                                                             | P2, P3 (consent UI) | High-confidence country when env is ambiguous                                       |
| **P5**    | WS-6 formatting call-site migration                                                      | P2                  | Locale-correct numbers/dates; USD caveat preserved                                  |
| **P6**    | WS-5 i18n catalog + per-file string migration (ongoing)                                  | P1                  | Fully localized CLI/TUI UI, file-by-file                                            |

P1 is shippable on its own and delivers the headline outcome ("CLI adapts to country & answers in the right
language") before any UI-string migration. P6 is long-tail and parallelizable.

### P1 — implemented (2026-06-02)

Shipped as the minimum-footprint core. Lean decisions made during implementation:

- **Resolver is a pure module, not an Effect service.** `src/locale/resolve.ts` — system signals (env + Intl)
  detected once and frozen in a module singleton; config overrides merged per call (cheap). Sub-ms, no I/O,
  no re-resolution machinery. Avoids the `Locale.Service` overhead WS-2 sketched until a second consumer needs it.
- **No network, no new package, no eager dictionaries.** GeoIP, the i18n catalog, and the formatting migration
  are all deferred and strictly lazy/opt-in — zero cost for users who don't trigger them; literally zero extra
  for English users.
- **`languageName` via `Intl.DisplayNames`** (no static language table) — universal language coverage; any
  BCP-47 tag the OS reports resolves (verified across 27 languages incl. CJK, Arabic/Hebrew RTL, region variants).
- **Currency is exhaustive**: `src/locale/region-currency.ts` maps all 247 ISO-3166 region codes (+ EU) to their
  ISO-4217 currency (CLDR-derived); USD only for genuinely unknown inputs.
- **`replyLanguage` default**: on for detected non-English locales, off for English — English users get no extra
  prompt bytes; others get localized replies automatically. Overridable (`true`/`false`/fixed tag) via config.
- **Files touched**: `src/locale/resolve.ts` (new), `src/config/config.ts` (`locale` field on `Info`),
  `src/session/system.ts` (`environmentImpl` + `<language>` block, config wired through `environment()`).
- **Verified**: `bun run typecheck` clean (0 errors); runtime smoke test across IT/US/C-POSIX/config-pin/
  reply-off/fixed-fr/autoDetect-off — all correct.

### P3 — partial (2026-06-02)

CLI surface for explicit control, shipped except the TUI picker:

- **`nikcli locale [show|set|reset]`** — `src/cli/cmd/locale.ts`, registered in `index.ts`. `show` prints the
  fully-resolved locale (each axis + source); `set` persists overrides (`--language/--region/--locale/--timezone/
--currency/--reply-language/--no-auto-detect`, `--global` default true) by merging the `locale` key into
  `nikcli.json` (same shape as `image-model`); `reset` clears it.
- **Per-run override instead of a yargs global flag**: `NIKCLI_LOCALE` / `NIKCLI_LANGUAGE` / `NIKCLI_REGION` are
  read fresh inside `resolveLocale()` at **highest priority** (above persisted config). Cleaner than threading a
  `--locale` flag through every command, and it works identically in the TUI. e.g. `NIKCLI_LOCALE=ja-JP nikcli …`.
- **Verified end-to-end**: `nikcli locale show` → `en-US`/intl; `NIKCLI_LOCALE=ja-JP nikcli locale show` →
  `ja-JP`/Japanese/JPY/reply Japanese/source `override`. Typecheck clean.

**Still pending in P3:** the `/locale` TUI slash-command + picker dialog (`dialog-locale.tsx`) and the first-run
onboarding consent step. The headless surface (command + env override) is complete.

---

## 7. File manifest (new vs touched)

**New**

- `src/geo/{geo,cache,tz-country,index}.ts` + tests
- `src/locale/{locale,format,index}.ts` + tests
- `src/locale/i18n/{index,en,it,zh}.ts` + `parity.test.ts`
- `src/cli/cmd/locale.ts`
- `src/cli/cmd/tui/component/dialog-locale.tsx`
- `src/cli/cmd/tui/context/i18n.tsx` (`useT`)
- `script/gen-tz-country.ts` (build-time map generator)

**Touched**

- `src/config/config.ts` — add `locale` to `Info` (+ regen JSON schema)
- `src/session/system.ts` — `environmentImpl` locale + `<language>` block
- `src/util/locale.ts` — route formatting through resolved locale
- `src/cli/cmd/tui/app.tsx` — register `/locale`, formatter swap, palette entry
- the 8 `Intl.NumberFormat("en-US"…)` call-sites (WS-6)
- `src/cli/cmd/tui/component/dialog-onboarding.tsx` — locale + GeoIP consent step
- `SECURITY.md` — geo privacy note
- `packages/nikcli/docs/*` — `locale` command + config docs

**Specs to update on each commit** (per repo rule): keep `specs/effect/schema.md` and this file in sync; cross-link
from `specs/integration-master-plan.md` as a new localization epoch.

---

## 8. Open decisions (need a call before P3)

1. **Which UI languages ship first?** Proposal: `en` (canonical) + `it` + `zh` (match app). Add `es/fr/de/pt/ja`
   as catalogs land.
2. **Default `replyLanguage` behavior:** auto-on for high-confidence non-English (proposed) vs always opt-in.
3. **GeoIP provider:** Cloudflare-trace-first (country-only, no key, lowest data) vs ipapi (richer, but full IP
   to a third party). Proposed: Cloudflare first, ipapi only as explicit fallback.
4. **Money localization extent:** grouping-only with fixed USD (proposed, safe) vs true local-currency display
   (requires FX + billing alignment — out of scope here).
