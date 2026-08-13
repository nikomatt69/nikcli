# TUI Theme Migration

| Field  | Value                                                            |
| ------ | ---------------------------------------------------------------- |
| Status | **Proposed and unimplemented**                                   |
| Scope  | `src/cli/cmd/tui/context/theme.tsx` and its 98 theme documents    |

## Where It Stands

Themes are flat color maps. A document declares `defs` (raw hex, usually a 12-step ramp plus named hues) and then a `dark` / `light` pair of **flat semantic-ish keys**: `background`, `backgroundPanel`, `backgroundElement`, `border`, `borderActive`, `borderSubtle`, `text`, `textMuted`, `primary`, `secondary`, `accent`, `error`, `warning`, `success`, `info`, the `diff*` family, the `markdown*` family, and `syntax*`.

Components read those keys directly. Measured across the TUI:

| Token               | Reads |
| ------------------- | -----: |
| `textMuted`         | 746   |
| `text`              | 359   |
| `primary`           | 207   |
| `warning`           | 111   |
| `error` / `borderSubtle` | 102 each |
| `success`           | 101   |
| `backgroundElement` | 81    |
| `accent`            | 74    |
| `backgroundPanel`   | 37    |
| `background`        | 33    |

Two structural problems follow:

1. **Foregrounds and backgrounds are unpaired.** `warning` is a single color. A component that wants a warning *badge* has to invent a background, and whether the result is readable depends on the theme. `selectedListItemText` exists precisely because one such pair was needed and got hardcoded as a one-off.
2. **There is no surface vocabulary.** `background`, `backgroundPanel`, and `backgroundElement` are three levels with no stated contract, so a new component picks one by imitation. Overlay and offset surfaces do not exist at all; dialogs pick `backgroundPanel` and hope.

With 98 theme documents, any new token is 98 edits unless it is derived. So the migration must be **derivation-first**: new tokens are computed from existing ones by default, and a theme overrides only where the derivation is wrong.

## Target

Semantic tokens that always carry the pair, plus explicit surface levels:

```
surface.base / surface.panel / surface.offset / surface.overlay
foreground.default / foreground.muted / foreground.subtle
accent.{fg,bg,border}
status.{error,warning,success,info}.{fg,bg}
border.{default,subtle,active,focus}
```

## Checklist

- [ ] Add semantic accent foreground and border tokens so components stop reading `primary` and `accent` for both roles.
- [ ] Add paired badge/label foreground+background tokens and retire the ad-hoc `selectedListItemText`.
- [ ] Add strong `warning` and `error` background treatments with matching readable foregrounds.
- [ ] Add `surface.offset` and `surface.overlay`, derived from the existing panel/element colors, and use them as the contextual defaults for dialogs and popovers.
- [ ] Use `foreground.default` for active cursors, `surface.offset` for disabled cursors, and a lighter accent for focused form borders.
- [ ] Decide whether "thinking" opacity stays a fixed `0.6` or becomes a presentation token of its own.
- [ ] Generate syntax styles from resolved tokens rather than from flat `syntax*` reads.
- [ ] Migrate surfaces one at a time behind a compatibility proxy, then delete the proxy once no flat reads remain.

## Constraint That Is Easy To Miss

`theme.tsx` statically imports **92 of the 98** theme JSON documents with `with { type: "json" }`. Every one of them is parsed into the TUI bundle at startup, whether or not the user's theme is among them. Any change that grows the per-theme document therefore grows startup cost for all themes at once.

Fixing that is a separate change — lazy-load the selected theme, keep one built-in eagerly — but it should land **before** tokens are added, not after, or the token expansion pays a multiplier. See ROADMAP item U3.

Six documents ship as JSON but are imported by nothing and referenced nowhere else in the repo: `arctic`, `muted`, `osaka-jade`, `oxocarbon`, `vivid`, `zinc`. Either wire them up or delete them — a theme no code can select is a trap for the next person adding one. (Themes can also arrive at runtime through `registerTheme`, which is how plugin themes work; that path is unaffected.)
