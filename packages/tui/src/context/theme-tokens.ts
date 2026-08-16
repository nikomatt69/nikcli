import { RGBA } from "@opentui/core"

export type StatusPair = {
  fg: RGBA
  bg: RGBA
}

export type SemanticTokens = {
  surface: {
    base: RGBA
    panel: RGBA
    offset: RGBA
    overlay: RGBA
  }
  foreground: {
    default: RGBA
    muted: RGBA
    subtle: RGBA
  }
  accent: {
    fg: RGBA
    bg: RGBA
    border: RGBA
    /** Document `accent` hue — distinct from `fg`, which is `primary`. */
    alt: RGBA
    /** Document `secondary` hue. */
    secondary: RGBA
  }
  status: {
    error: StatusPair
    warning: StatusPair
    success: StatusPair
    info: StatusPair
  }
  border: {
    default: RGBA
    subtle: RGBA
    active: RGBA
    focus: RGBA
  }
  badge: StatusPair
  syntax: {
    comment: RGBA
    keyword: RGBA
    function: RGBA
    variable: RGBA
    string: RGBA
    number: RGBA
    type: RGBA
    operator: RGBA
    punctuation: RGBA
  }
  markdown: {
    text: RGBA
    heading: RGBA
    link: RGBA
    linkText: RGBA
    code: RGBA
    blockQuote: RGBA
    emph: RGBA
    strong: RGBA
    horizontalRule: RGBA
    listItem: RGBA
    listEnumeration: RGBA
    image: RGBA
    imageText: RGBA
    codeBlock: RGBA
  }
  diff: {
    added: RGBA
    removed: RGBA
    context: RGBA
    addedBg: RGBA
    removedBg: RGBA
    contextBg: RGBA
    hunkHeader: RGBA
    highlightAdded: RGBA
    highlightRemoved: RGBA
    lineNumber: RGBA
    addedLineNumberBg: RGBA
    removedLineNumberBg: RGBA
  }
  thinkingOpacity: number
}

export type TokenSource = {
  primary: RGBA
  secondary: RGBA
  accent: RGBA
  error: RGBA
  warning: RGBA
  success: RGBA
  info: RGBA
  text: RGBA
  textMuted: RGBA
  selectedListItemText: RGBA
  background: RGBA
  backgroundPanel: RGBA
  backgroundElement: RGBA
  backgroundMenu: RGBA
  border: RGBA
  borderActive: RGBA
  borderSubtle: RGBA
  syntaxComment: RGBA
  syntaxKeyword: RGBA
  syntaxFunction: RGBA
  syntaxVariable: RGBA
  syntaxString: RGBA
  syntaxNumber: RGBA
  syntaxType: RGBA
  syntaxOperator: RGBA
  syntaxPunctuation: RGBA
  markdownText: RGBA
  markdownHeading: RGBA
  markdownLink: RGBA
  markdownLinkText: RGBA
  markdownCode: RGBA
  markdownBlockQuote: RGBA
  markdownEmph: RGBA
  markdownStrong: RGBA
  markdownHorizontalRule: RGBA
  markdownListItem: RGBA
  markdownListEnumeration: RGBA
  markdownImage: RGBA
  markdownImageText: RGBA
  markdownCodeBlock: RGBA
  diffAdded: RGBA
  diffRemoved: RGBA
  diffContext: RGBA
  diffAddedBg: RGBA
  diffRemovedBg: RGBA
  diffContextBg: RGBA
  diffHunkHeader: RGBA
  diffHighlightAdded: RGBA
  diffHighlightRemoved: RGBA
  diffLineNumber: RGBA
  diffAddedLineNumberBg: RGBA
  diffRemovedLineNumberBg: RGBA
}

export function tint(base: RGBA, overlay: RGBA, alpha: number): RGBA {
  const r = base.r + (overlay.r - base.r) * alpha
  const g = base.g + (overlay.g - base.g) * alpha
  const b = base.b + (overlay.b - base.b) * alpha
  return RGBA.fromInts(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}

export function luminance(color: RGBA): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b
}

export function contrastFg(bg: RGBA): RGBA {
  return luminance(bg) > 0.5 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
}

function statusPair(base: RGBA, hue: RGBA, alpha: number): StatusPair {
  return {
    fg: hue,
    bg: tint(base, hue, alpha),
  }
}

export function deriveSemanticTokens(
  colors: TokenSource,
  options: {
    hasSelectedListItemText: boolean
    thinkingOpacity: number
    mode: "dark" | "light"
  },
): SemanticTokens {
  const fill = options.mode === "dark" ? 0.28 : 0.16
  const badgeBg = colors.primary
  return {
    surface: {
      base: colors.background,
      panel: colors.backgroundPanel,
      offset: colors.backgroundElement,
      overlay: colors.backgroundMenu,
    },
    foreground: {
      default: colors.text,
      muted: colors.textMuted,
      subtle: tint(colors.textMuted, colors.background, 0.4),
    },
    accent: {
      fg: colors.primary,
      bg: tint(colors.background, colors.primary, fill),
      border: tint(colors.primary, colors.text, 0.35),
      alt: colors.accent,
      secondary: colors.secondary,
    },
    status: {
      error: statusPair(colors.background, colors.error, fill),
      warning: statusPair(colors.background, colors.warning, fill),
      success: statusPair(colors.background, colors.success, fill),
      info: statusPair(colors.background, colors.info, fill),
    },
    border: {
      default: colors.border,
      subtle: colors.borderSubtle,
      active: colors.borderActive,
      focus: tint(colors.primary, colors.text, 0.35),
    },
    badge: {
      fg: options.hasSelectedListItemText ? colors.selectedListItemText : contrastFg(badgeBg),
      bg: badgeBg,
    },
    syntax: {
      comment: colors.syntaxComment,
      keyword: colors.syntaxKeyword,
      function: colors.syntaxFunction,
      variable: colors.syntaxVariable,
      string: colors.syntaxString,
      number: colors.syntaxNumber,
      type: colors.syntaxType,
      operator: colors.syntaxOperator,
      punctuation: colors.syntaxPunctuation,
    },
    markdown: {
      text: colors.markdownText,
      heading: colors.markdownHeading,
      link: colors.markdownLink,
      linkText: colors.markdownLinkText,
      code: colors.markdownCode,
      blockQuote: colors.markdownBlockQuote,
      emph: colors.markdownEmph,
      strong: colors.markdownStrong,
      horizontalRule: colors.markdownHorizontalRule,
      listItem: colors.markdownListItem,
      listEnumeration: colors.markdownListEnumeration,
      image: colors.markdownImage,
      imageText: colors.markdownImageText,
      codeBlock: colors.markdownCodeBlock,
    },
    diff: {
      added: colors.diffAdded,
      removed: colors.diffRemoved,
      context: colors.diffContext,
      addedBg: colors.diffAddedBg,
      removedBg: colors.diffRemovedBg,
      contextBg: colors.diffContextBg,
      hunkHeader: colors.diffHunkHeader,
      highlightAdded: colors.diffHighlightAdded,
      highlightRemoved: colors.diffHighlightRemoved,
      lineNumber: colors.diffLineNumber,
      addedLineNumberBg: colors.diffAddedLineNumberBg,
      removedLineNumberBg: colors.diffRemovedLineNumberBg,
    },
    thinkingOpacity: options.thinkingOpacity,
  }
}
