export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

export const SplitBorder = {
  border: ["left" as const, "right" as const],
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
}

// Glass/Rounded border characters for glassmorphism effect
export const GlassBorder = {
  border: ["top", "bottom", "left", "right"] as const,
  customBorderChars: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    vertical: "│",
    horizontal: "─",
    topT: "┬",
    bottomT: "┴",
    leftT: "├",
    rightT: "┤",
    cross: "┼",
  },
}

// Re-export GlassBorder as GlassBorderLight for backward compatibility
// The distinction was cosmetic; both styles are identical.
export const GlassBorderLight = GlassBorder

// Minimal glass border - only corners, no sides
/** Single-line characters shared by dialog dividers and separators */
export const DialogSeparatorChars = {
  horizontal: "─",
  vertical: "│",
  dot: "·",
} as const

export const GlassBorderMinimal = {
  border: [] as const,
  customBorderChars: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    vertical: "│",
    horizontal: "─",
    topT: "┬",
    bottomT: "┴",
    leftT: "├",
    rightT: "┤",
    cross: "┼",
  },
}
