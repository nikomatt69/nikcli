# TUI Theme Migration

| Field  | Value                                                          |
| ------ | -------------------------------------------------------------- |
| Status | **U3 and U2 done**                                             |
| Scope  | `src/cli/cmd/tui/context/theme.tsx` and its 98 theme documents |

## Where It Stands

Theme **documents** are still flat color maps. A document declares `defs` and then a `dark` / `light` pair of keys: `background`, `backgroundPanel`, `backgroundElement`, `border`, `borderActive`, `borderSubtle`, `text`, `textMuted`, `primary`, `secondary`, `accent`, `error`, `warning`, `success`, `info`, the `diff*` family, the `markdown*` family, and `syntax*`.

`deriveSemanticTokens` computes the nested vocabulary from those resolved colors. No theme JSON gained keys. The `Theme` type is nested-only. Flat document keys remain on the runtime object for plugin `TuiThemeCurrent`, and documents are still written with the original flat names.

## Target

Semantic tokens that always carry the pair, plus explicit surface levels:

```
surface.base / surface.panel / surface.offset / surface.overlay
foreground.default / foreground.muted / foreground.subtle
accent.{fg,bg,border,alt,secondary}
status.{error,warning,success,info}.{fg,bg}
border.{default,subtle,active,focus}
badge.{fg,bg}
```

`accent.fg` is `primary`. `accent.alt` is the document `accent` hue. `accent.secondary` is the document `secondary` hue. `thinkingOpacity` stays a presentation token defaulting to `0.6`.

## Checklist

- [x] U3: lazy-load built-in theme JSON — only `nikcli` is parsed at module load; the selected theme loads on demand; previously unwired documents are in the catalog.
- [x] Derive `accent.{fg,bg,border}` from `primary` / a lighter mix so fill and border are not the same color.
- [x] Derive `badge.{fg,bg}` (contrast on `primary`, or explicit `selectedListItemText`) and use it in shared dialog primitives. Flat `selectedListItemText` remains until remaining call sites move.
- [x] Derive `status.{error,warning,success,info}.{fg,bg}` and use the strong warning/error pair on toasts.
- [x] Derive `surface.offset` / `surface.overlay` from element/menu colors. Dialog chrome, toasts, and the prompt autocomplete popover use overlay; focused inputs use offset.
- [x] Active prompt cursor uses `foreground.default`; disabled cursor uses `surface.offset`; focused form borders use `border.focus`.
- [x] Keep "thinking" opacity as a presentation token at `0.6`.
- [x] Generate syntax styles from nested `syntax` / `markdown` / `diff` tokens (still derived from the flat document keys).
- [x] Remaining UI reads of `selectedListItemText` use `badge.fg`. The document field stays as the optional badge-foreground override.
- [x] Migrate TUI callers off flat `text` / `textMuted` / `primary` / status / surface / border / diff keys onto the nested vocabulary.
- [x] Drop remaining `theme.secondary` and bare `theme.accent` RGBA reads (`accent.alt` / `accent.secondary`), then delete the `asDual` compatibility proxy and the `ThemeColors` intersection on `Theme`.

## Constraint That Is Easy To Miss

U3 (landed): built-in JSON is lazy. `theme-catalog.ts` eagerly parses only `nikcli.json`. Every other document — including the six that previously shipped unwired (`arctic`, `muted`, `osaka-jade`, `oxocarbon`, `vivid`, `zinc`) — is a static `import()` loader, so bun compile still embeds the files and the runtime only parses the selected theme plus the fallback. The picker lists catalog ids via `names()` without loading documents. Plugin `addTheme` / `hasTheme` is unchanged. Do **not** go back to static `with { type: "json" }` imports of the whole set.

Do not treat `accent.fg` as the document `accent` hue. `accent.fg` is `primary`. The extra hue is `accent.alt`. See ROADMAP item U2 (landed).
