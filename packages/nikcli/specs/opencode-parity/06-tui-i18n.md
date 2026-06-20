## TUI internationalization (i18n)

Introduce string translation for the `packages/nikcli` terminal UI.

> Imported from opencode `specs/06-app-i18n-audit.md` + `specs/07-ui-i18n-audit.md`, re-scoped to
> nikcli's TUI (`packages/nikcli`). opencode already has `useLanguage().t(...)` in `packages/app`
> and a UI i18n context in `packages/ui`; the **TUI has no string-translation system at all**.

---

### Summary

`packages/nikcli`'s `Locale` module (`src/util/locale.ts`) only does locale-sensitive
**formatting** (titlecase, time/date, abbreviated numbers, durations). All user-facing TUI copy
— placeholders, tooltips, toasts, status labels, command titles, dialog text — is hardcoded
English. We will add a small, dependency-free i18n layer with a `useLanguage().t(key, params?)`
accessor and English/zh dictionaries, then migrate copy surface by surface (highest-traffic
first), mirroring the architecture already proven in `packages/app`/`packages/ui`.

---

### Goals

- Provide a `t(key, params?)` translation function + `locale()` accessor to the TUI tree.
- Ship a complete English dictionary (the default) and a second locale (`zh`) to validate the
  system, with dictionary key-parity enforced by a test.
- Migrate the highest-traffic surfaces first (prompt, session view, command palette, toasts).
- Route existing `Locale` formatting through the active locale.

### Non-goals

- Translating developer logs (`console.*`), technical identifiers (LSP/MCP/URLs), or keycaps.
- Translating every string in one pass — this is an incremental audit like upstream 06/07.
- Server-side / CLI-flag i18n (separate effort).

---

### Current state

- `src/util/locale.ts` — `Locale.titlecase/time/datetime/number/duration/truncateMiddle`; no
  translation table, no locale selection.
- TUI components hardcode English, e.g. `component/prompt/index.tsx`:
  - placeholders `PLACEHOLDERS`/`SHELL_PLACEHOLDERS` ("Ask anything…", "Run a command…"),
  - toasts ("Voice transcript inserted and copied", "Failed to send — check your connection…"),
  - footer labels ("commands", "interrupt", "Sponsored:", "web", "rec").
- `src/locale/{region-currency,resolve}.ts` resolves a region/currency but is not wired to a
  string table.

### Evidence

- No `useLanguage`/`useI18n`/`t(` usages anywhere under `src/cli/cmd/tui` (grep). The i18n
  contexts that exist (`packages/ui/src/context/i18n.tsx`, `packages/app/src/i18n/*`) belong to
  the shared web packages, not the TUI.

---

### Proposed approach

#### 1) TUI i18n context

New `src/cli/cmd/tui/context/language.tsx` (Solid context, mirrors `packages/app`):

- `LanguageProvider` resolving the locale from config (`sync.data.config`), then env
  (`LANG`/`LC_ALL`), defaulting to `en`.
- `useLanguage()` → `{ t(key, params?), locale() }`.
- `t` does dotted-key lookup with `{{param}}` interpolation; missing keys fall back to English,
  then to the key itself in dev (to surface gaps).

#### 2) Dictionaries

- `src/cli/cmd/tui/i18n/en.ts` (source of truth) and `src/cli/cmd/tui/i18n/zh.ts`.
- Namespace by surface: `prompt.*`, `session.*`, `command.*`, `toast.*`, `dialog.*`,
  `status.*`, `common.*` (reuse upstream conventions from spec 06).
- Test `test/cli/tui/i18n-parity.test.ts`: `en` and `zh` have identical key sets.

#### 3) Wire the provider + route `Locale`

- Wrap the TUI root (`app.tsx`) in `LanguageProvider`.
- `Locale.number/time/datetime/duration` accept/derive the active `locale()` so formatting is
  locale-correct (not just `toLocaleString(undefined, …)`).

#### 4) Incremental migration (priority order)

1. `component/prompt/index.tsx` — placeholders, toasts, footer labels.
2. `routes/session/index.tsx` — status labels, part section titles, empty states.
3. Command palette titles/categories (`command.register(...)` call sites).
4. Toasts/notifications across dialogs.
5. Remaining dialogs (settings, provider, remote, web preview).

Each migration replaces literals with `t("...")` keys added to **both** dictionaries.

---

### Phased implementation steps

1. Add `language.tsx` + `i18n/en.ts` + `i18n/zh.ts` + parity test; provider wraps root. No copy
   migrated yet (system in place, behavior unchanged because everything still reads English).
2. Migrate `prompt/index.tsx` copy → `prompt.*` keys; verify parity test green.
3. Migrate `routes/session/index.tsx` and command-palette titles.
4. Route `Locale.*` formatting through `locale()`.
5. Sweep remaining dialogs; keep an "at-a-glance remaining files" list like upstream 06.

---

### Backward compatibility

- Default locale `en` reproduces current strings exactly.
- Keys missing in a non-English dictionary fall back to English (never blank UI).

---

### Risk + mitigations

- String concatenation that assumes English word order → use `{{param}}` templates, not `+`.
- Dictionary drift between locales → enforced by the parity test in CI.
- Over-translation of technical tokens → audit excludes logs, keycaps, LSP/MCP/URLs (as upstream).

---

### Validation plan

- `bun test test/cli/tui/i18n-parity.test.ts` → exit 0 (en/zh key sets equal).
- `bun run typecheck` → exit 0 after each migration batch.
- Manual: set locale to `zh` via config/env, launch TUI, confirm migrated surfaces render
  translated copy and formatting (numbers/dates) follows the locale; set back to `en`, confirm
  identical-to-today output.

---

### Rollout plan

- Land the system (provider + dictionaries + parity test) first — no visible change.
- Migrate surfaces incrementally; each batch is independently shippable.
- Locale selection stays config-driven; `en` remains default.

---

### Open questions

- Where should TUI locale selection live — reuse `src/locale/resolve.ts`, app config, or a new
  setting in the settings dialog?
- Which second locale best validates the system for nikcli's audience (zh, es, …)?
- Should the TUI dictionaries eventually share keys with `packages/ui`'s `ui.*` namespace, or
  stay independent?
