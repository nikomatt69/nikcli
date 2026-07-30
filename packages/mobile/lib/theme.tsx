import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react"
import { View } from "react-native"
import { useColorScheme, vars } from "nativewind"
import { getThemePreferences, setStoredColorScheme, setStoredTheme } from "./storage"

import abyss from "./themes/abyss.json"
import alpine from "./themes/alpine.json"
import amethyst from "./themes/amethyst.json"
import apple from "./themes/apple.json"
import arctic from "./themes/arctic.json"
import aurorasky from "./themes/aurorasky.json"
import iosBlue from "./themes/ios-blue.json"
import iosIndigo from "./themes/ios-indigo.json"
import iosPurple from "./themes/ios-purple.json"
import iosPink from "./themes/ios-pink.json"
import iosRed from "./themes/ios-red.json"
import iosOrange from "./themes/ios-orange.json"
import iosYellow from "./themes/ios-yellow.json"
import iosGreen from "./themes/ios-green.json"
import iosMint from "./themes/ios-mint.json"
import iosTeal from "./themes/ios-teal.json"
import iosCyan from "./themes/ios-cyan.json"
import iosBrown from "./themes/ios-brown.json"
import ocean from "./themes/ocean.json"
import lagoon from "./themes/lagoon.json"
import coralreef from "./themes/coralreef.json"
import sahara from "./themes/sahara.json"
import rainforest from "./themes/rainforest.json"
import redwood from "./themes/redwood.json"
import glacierblue from "./themes/glacierblue.json"
import volcano from "./themes/volcano.json"
import lava from "./themes/lava.json"
import sunsetcoast from "./themes/sunsetcoast.json"
import cherryblossom from "./themes/cherryblossom.json"
import wisteria from "./themes/wisteria.json"
import rosewood from "./themes/rosewood.json"
import terracotta from "./themes/terracotta.json"
import saffron from "./themes/saffron.json"
import honeycomb from "./themes/honeycomb.json"
import emeraldcity from "./themes/emeraldcity.json"
import jade from "./themes/jade.json"
import sapphire from "./themes/sapphire.json"
import ruby from "./themes/ruby.json"
import topaz from "./themes/topaz.json"
import pearl from "./themes/pearl.json"
import denim from "./themes/denim.json"
import mocha from "./themes/mocha.json"
import cinnamon from "./themes/cinnamon.json"
import mintjulep from "./themes/mintjulep.json"
import citrus from "./themes/citrus.json"
import tropical from "./themes/tropical.json"
import monsoon from "./themes/monsoon.json"
import blizzard from "./themes/blizzard.json"
import ember from "./themes/ember.json"
import moss from "./themes/moss.json"
import sequoia from "./themes/sequoia.json"
import harbor from "./themes/harbor.json"
import savanna from "./themes/savanna.json"
import canyon from "./themes/canyon.json"
import nebula from "./themes/nebula.json"
import aura from "./themes/aura.json"
import ayu from "./themes/ayu.json"
import ayuai from "./themes/ayuai.json"
import blood from "./themes/blood.json"
import brain from "./themes/brain.json"
import carbonfox from "./themes/carbonfox.json"
import catmoe from "./themes/catmoe.json"
import catppuccin from "./themes/catppuccin.json"
import catppuccinFrappe from "./themes/catppuccin-frappe.json"
import catppuccinLatte from "./themes/catppuccin-latte.json"
import catppuccinMacchiato from "./themes/catppuccin-macchiato.json"
import charcoal from "./themes/charcoal.json"
import chromatic from "./themes/chromatic.json"
import cobalt2 from "./themes/cobalt2.json"
import cosmic from "./themes/cosmic.json"
import cursor from "./themes/cursor.json"
import cyber from "./themes/cyber.json"
import dawnfox from "./themes/dawnfox.json"
import dimension from "./themes/dimension.json"
import dracula from "./themes/dracula.json"
import draculaOfficial from "./themes/dracula-official.json"
import duo from "./themes/duo.json"
import dusk from "./themes/dusk.json"
import ebony from "./themes/ebony.json"
import equilibrium from "./themes/equilibrium.json"
import ethereal from "./themes/ethereal.json"
import everforest from "./themes/everforest.json"
import flexoki from "./themes/flexoki.json"
import fusion from "./themes/fusion.json"
import ghost from "./themes/ghost.json"
import github from "./themes/github.json"
import githubDark from "./themes/github-dark.json"
import githubDimmed from "./themes/github-dimmed.json"
import githubLight from "./themes/github-light.json"
import glass from "./themes/glass.json"
import gold from "./themes/gold.json"
import gone from "./themes/gone.json"
import greyscale from "./themes/greyscale.json"
import gruvbox from "./themes/gruvbox.json"
import hacker from "./themes/hacker.json"
import holo from "./themes/holo.json"
import ink from "./themes/ink.json"
import jet from "./themes/jet.json"
import kanagawa from "./themes/kanagawa.json"
import lavender from "./themes/lavender.json"
import lightph from "./themes/lightph.json"
import lucentOrng from "./themes/lucent-orng.json"
import material from "./themes/material.json"
import materialOcean from "./themes/material-ocean.json"
import matrix from "./themes/matrix.json"
import mercury from "./themes/mercury.json"
import midnight from "./themes/midnight.json"
import modern from "./themes/modern.json"
import monokai from "./themes/monokai.json"
import muted from "./themes/muted.json"
import neon from "./themes/neon.json"
import neonfusion from "./themes/neonfusion.json"
import neutral from "./themes/neutral.json"
import nightowl from "./themes/nightowl.json"
import nikcli from "./themes/nikcli.json"
import nord from "./themes/nord.json"
import nordic from "./themes/nordic.json"
import nova from "./themes/nova.json"
import oneDark from "./themes/one-dark.json"
import onePro from "./themes/one-pro.json"
import onyx from "./themes/onyx.json"
import obsidian from "./themes/obsidian.json"
import orng from "./themes/orng.json"
import osakaJade from "./themes/osaka-jade.json"
import oxocarbon from "./themes/oxocarbon.json"
import palenight from "./themes/palenight.json"
import poimandres from "./themes/poimandres.json"
import prism from "./themes/prism.json"
import radiant from "./themes/radiant.json"
import rosepine from "./themes/rosepine.json"
import shadow from "./themes/shadow.json"
import silicon from "./themes/silicon.json"
import slate from "./themes/slate.json"
import soft from "./themes/soft.json"
import solarized from "./themes/solarized.json"
import spectrum from "./themes/spectrum.json"
import starlight from "./themes/starlight.json"
import sunrise from "./themes/sunrise.json"
import synthwave84 from "./themes/synthwave84.json"
import tech from "./themes/tech.json"
import tokyonight from "./themes/tokyonight.json"
import tokyonightStorm from "./themes/tokyonight-storm.json"
import vapor from "./themes/vapor.json"
import vercel from "./themes/vercel.json"
import vesper from "./themes/vesper.json"
import vivid from "./themes/vivid.json"
import voidTheme from "./themes/void.json"
import vscode from "./themes/vscode.json"
import zenburn from "./themes/zenburn.json"
import zinc from "./themes/zinc.json"

// Theme JSON type
export type ThemeJson = {
  $schema?: string
  defs?: Record<string, string>
  theme: Record<string, string | ThemeColorVariant | undefined>
}

export type ThemeColorVariant = {
  dark: string
  light: string
}

// Resolved theme colors
export type ThemeColors = {
  primary: string
  secondary: string
  accent: string
  error: string
  warning: string
  success: string
  info: string
  text: string
  textMuted: string
  background: string
  backgroundPanel: string
  backgroundElement: string
  border: string
  borderActive: string
  borderSubtle: string
  // Diff colors
  diffAdded: string
  diffRemoved: string
  diffContext: string
  diffHunkHeader: string
  diffHighlightAdded: string
  diffHighlightRemoved: string
  diffAddedBg: string
  diffRemovedBg: string
  diffContextBg: string
  diffLineNumber: string
  diffAddedLineNumberBg: string
  diffRemovedLineNumberBg: string
  // Markdown colors
  markdownText: string
  markdownHeading: string
  markdownLink: string
  markdownLinkText: string
  markdownCode: string
  markdownBlockQuote: string
  markdownEmph: string
  markdownStrong: string
  markdownHorizontalRule: string
  markdownListItem: string
  markdownListEnumeration: string
  markdownImage: string
  markdownImageText: string
  markdownCodeBlock: string
  // Syntax colors
  syntaxComment: string
  syntaxKeyword: string
  syntaxFunction: string
  syntaxVariable: string
  syntaxString: string
  syntaxNumber: string
  syntaxType: string
  syntaxOperator: string
  syntaxPunctuation: string
  // Mobile-specific colors (derived from theme)
  surface: string
  surfaceMuted: string
  surfaceRaised: string
  panel: string
  ink: string
  soft: string
  muted: string
  accentLight: string
  warn: string
  danger: string
  critical: string
  focusRing: string
  shadowSoft: string
  shadowStrong: string
  tabBackground: string
  tabSurface: string
  tabStatus: string
  shadow: string
  codeBackground: string
  codeText: string
  codeBlockBackground: string
  codeAccent: string
  reasoningBackground: string
  userBubble: string
  assistantBubble: string
}

// Theme registry type
export type ThemeRegistry = {
  [key: string]: ThemeJson
}

// Theme info for selection UI
export type ThemeInfo = {
  id: string
  name: string
  author?: string
}

// Default themes registry
export const THEMES: ThemeRegistry = {
  abyss,
  arctic,
  aura,
  ayu,
  ayuai,
  blood,
  brain,
  carbonfox,
  catmoe,
  catppuccin,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-latte": catppuccinLatte,
  "catppuccin-macchiato": catppuccinMacchiato,
  charcoal,
  chromatic,
  cobalt2,
  cosmic,
  cursor,
  cyber,
  dawnfox,
  dimension,
  dracula,
  "dracula-official": draculaOfficial,
  duo,
  dusk,
  ebony,
  equilibrium,
  ethereal,
  everforest,
  flexoki,
  fusion,
  ghost,
  github,
  "github-dark": githubDark,
  "github-dimmed": githubDimmed,
  "github-light": githubLight,
  glass,
  gold,
  gone,
  greyscale,
  gruvbox,
  hacker,
  holo,
  ink,
  jet,
  kanagawa,
  lavender,
  lightph,
  "lucent-orng": lucentOrng,
  material,
  "material-ocean": materialOcean,
  matrix,
  mercury,
  midnight,
  modern,
  monokai,
  muted,
  neon,
  neonfusion,
  neutral,
  nightowl,
  nikcli,
  nord,
  nordic,
  nova,
  "one-dark": oneDark,
  "one-pro": onePro,
  onyx,
  obsidian,
  orng,
  "osaka-jade": osakaJade,
  oxocarbon,
  palenight,
  poimandres,
  prism,
  radiant,
  rosepine,
  shadow,
  silicon,
  slate,
  soft,
  solarized,
  spectrum,
  starlight,
  sunrise,
  synthwave84,
  tech,
  tokyonight,
  "tokyonight-storm": tokyonightStorm,
  vapor,
  vercel,
  vesper,
  vivid,
  void: voidTheme,
  vscode,
  zenburn,
  zinc,
  apple,
  "ios-blue": iosBlue,
  "ios-indigo": iosIndigo,
  "ios-purple": iosPurple,
  "ios-pink": iosPink,
  "ios-red": iosRed,
  "ios-orange": iosOrange,
  "ios-yellow": iosYellow,
  "ios-green": iosGreen,
  "ios-mint": iosMint,
  "ios-teal": iosTeal,
  "ios-cyan": iosCyan,
  "ios-brown": iosBrown,
  ocean,
  lagoon,
  coralreef,
  sahara,
  rainforest,
  redwood,
  alpine,
  glacierblue,
  volcano,
  lava,
  aurorasky,
  sunsetcoast,
  cherryblossom,
  wisteria,
  rosewood,
  terracotta,
  saffron,
  honeycomb,
  emeraldcity,
  jade,
  sapphire,
  ruby,
  amethyst,
  topaz,
  pearl,
  denim,
  mocha,
  cinnamon,
  mintjulep,
  citrus,
  tropical,
  monsoon,
  blizzard,
  ember,
  moss,
  sequoia,
  harbor,
  savanna,
  canyon,
  nebula,
}

// Theme info for UI display
export const THEME_LIST: ThemeInfo[] = [
  { id: "nikcli", name: "Nikcli", author: "nikcli" },
  { id: "nord", name: "Nord", author: "arcticicestudio" },
  { id: "dracula", name: "Dracula", author: "Dracula Theme" },
  { id: "dracula-official", name: "Dracula Official" },
  { id: "github", name: "GitHub" },
  { id: "github-dark", name: "GitHub Dark" },
  { id: "github-light", name: "GitHub Light" },
  { id: "github-dimmed", name: "GitHub Dimmed" },
  { id: "monokai", name: "Monokai" },
  { id: "tokyonight", name: "Tokyo Night", author: "folke" },
  { id: "tokyonight-storm", name: "Tokyo Night Storm" },
  { id: "nightowl", name: "Night Owl", author: "sarah.drasner" },
  { id: "one-dark", name: "One Dark", author: "atom One Dark" },
  { id: "one-pro", name: "One Pro" },
  { id: "catppuccin", name: "Catppuccin Mocha", author: "Catppuccin" },
  { id: "catppuccin-frappe", name: "Catppuccin Frappe" },
  { id: "catppuccin-macchiato", name: "Catppuccin Macchiato" },
  { id: "catppuccin-latte", name: "Catppuccin Latte" },
  { id: "material", name: "Material", author: "mattlewis92" },
  { id: "material-ocean", name: "Material Ocean" },
  { id: "solarized", name: "Solarized", author: "ethanschoonover" },
  { id: "gruvbox", name: "Gruvbox", author: "morhetz" },
  { id: "kanagawa", name: "Kanagawa", author: "rebelot" },
  { id: "rosepine", name: "Rose Pine", author: "rose-pine" },
  { id: "poimandres", name: "Poimandres", author: "rootzoll" },
  { id: "nordic", name: "Nordic" },
  { id: "oxocarbon", name: "Oxocarbon" },
  { id: "ayu", name: "Ayu" },
  { id: "arctic", name: "Arctic" },
  { id: "abyss", name: "Abyss" },
  { id: "aura", name: "Aura" },
  { id: "blood", name: "Blood" },
  { id: "brain", name: "Brain" },
  { id: "carbonfox", name: "Carbon Fox" },
  { id: "catmoe", name: "CatMoe" },
  { id: "charcoal", name: "Charcoal" },
  { id: "chromatic", name: "Chromatic" },
  { id: "cobalt2", name: "Cobalt 2", author: "wesbos" },
  { id: "cosmic", name: "Cosmic" },
  { id: "cursor", name: "Cursor" },
  { id: "cyber", name: "Cyber" },
  { id: "dawnfox", name: "Dawn Fox" },
  { id: "dimension", name: "Dimension" },
  { id: "duo", name: "Duo" },
  { id: "dusk", name: "Dusk" },
  { id: "ebony", name: "Ebony" },
  { id: "equilibrium", name: "Equilibrium" },
  { id: "ethereal", name: "Ethereal" },
  { id: "everforest", name: "Everforest" },
  { id: "flexoki", name: "Flexoki" },
  { id: "fusion", name: "Fusion" },
  { id: "ghost", name: "Ghost" },
  { id: "glass", name: "Glass" },
  { id: "gold", name: "Gold" },
  { id: "gone", name: "Gone" },
  { id: "greyscale", name: "Greyscale" },
  { id: "hacker", name: "Hacker" },
  { id: "holo", name: "Holo" },
  { id: "ink", name: "Ink" },
  { id: "jet", name: "Jet" },
  { id: "lavender", name: "Lavender" },
  { id: "lightph", name: "LightPH" },
  { id: "lucent-orng", name: "Lucent Orange" },
  { id: "matrix", name: "Matrix" },
  { id: "mercury", name: "Mercury" },
  { id: "midnight", name: "Midnight" },
  { id: "modern", name: "Modern" },
  { id: "muted", name: "Muted" },
  { id: "neon", name: "Neon" },
  { id: "neonfusion", name: "Neon Fusion" },
  { id: "neutral", name: "Neutral" },
  { id: "nova", name: "Nova" },
  { id: "onyx", name: "Onyx" },
  { id: "obsidian", name: "Obsidian" },
  { id: "orng", name: "Orange" },
  { id: "osaka-jade", name: "Osaka Jade" },
  { id: "palenight", name: "Palenight" },
  { id: "prism", name: "Prism" },
  { id: "radiant", name: "Radiant" },
  { id: "shadow", name: "Shadow" },
  { id: "silicon", name: "Silicon" },
  { id: "slate", name: "Slate" },
  { id: "soft", name: "Soft" },
  { id: "spectrum", name: "Spectrum" },
  { id: "starlight", name: "Starlight" },
  { id: "sunrise", name: "Sunrise" },
  { id: "synthwave84", name: "Synthwave 84" },
  { id: "tech", name: "Tech" },
  { id: "vapor", name: "Vapor" },
  { id: "vercel", name: "Vercel" },
  { id: "vesper", name: "Vesper" },
  { id: "vivid", name: "Vivid" },
  { id: "void", name: "Void" },
  { id: "vscode", name: "VS Code" },
  { id: "zenburn", name: "Zenburn" },
  { id: "zinc", name: "Zinc" },
  { id: "apple", name: "Apple" },
  { id: "ios-blue", name: "iOS Blue" },
  { id: "ios-indigo", name: "iOS Indigo" },
  { id: "ios-purple", name: "iOS Purple" },
  { id: "ios-pink", name: "iOS Pink" },
  { id: "ios-red", name: "iOS Red" },
  { id: "ios-orange", name: "iOS Orange" },
  { id: "ios-yellow", name: "iOS Yellow" },
  { id: "ios-green", name: "iOS Green" },
  { id: "ios-mint", name: "iOS Mint" },
  { id: "ios-teal", name: "iOS Teal" },
  { id: "ios-cyan", name: "iOS Cyan" },
  { id: "ios-brown", name: "iOS Brown" },
  { id: "ocean", name: "Ocean" },
  { id: "lagoon", name: "Lagoon" },
  { id: "coralreef", name: "Coral Reef" },
  { id: "sahara", name: "Sahara" },
  { id: "rainforest", name: "Rainforest" },
  { id: "redwood", name: "Redwood" },
  { id: "alpine", name: "Alpine" },
  { id: "glacierblue", name: "Glacier Blue" },
  { id: "volcano", name: "Volcano" },
  { id: "lava", name: "Lava" },
  { id: "aurorasky", name: "Aurora Sky" },
  { id: "sunsetcoast", name: "Sunset Coast" },
  { id: "cherryblossom", name: "Cherry Blossom" },
  { id: "wisteria", name: "Wisteria" },
  { id: "rosewood", name: "Rosewood" },
  { id: "terracotta", name: "Terracotta" },
  { id: "saffron", name: "Saffron" },
  { id: "honeycomb", name: "Honeycomb" },
  { id: "emeraldcity", name: "Emerald City" },
  { id: "jade", name: "Jade" },
  { id: "sapphire", name: "Sapphire" },
  { id: "ruby", name: "Ruby" },
  { id: "amethyst", name: "Amethyst" },
  { id: "topaz", name: "Topaz" },
  { id: "pearl", name: "Pearl" },
  { id: "denim", name: "Denim" },
  { id: "mocha", name: "Mocha" },
  { id: "cinnamon", name: "Cinnamon" },
  { id: "mintjulep", name: "Mint Julep" },
  { id: "citrus", name: "Citrus" },
  { id: "tropical", name: "Tropical" },
  { id: "monsoon", name: "Monsoon" },
  { id: "blizzard", name: "Blizzard" },
  { id: "ember", name: "Ember" },
  { id: "moss", name: "Moss" },
  { id: "sequoia", name: "Sequoia" },
  { id: "harbor", name: "Harbor" },
  { id: "savanna", name: "Savanna" },
  { id: "canyon", name: "Canyon" },
  { id: "nebula", name: "Nebula" },
]

// Hex to RGBA helper
function hexToRgba(hex: string, alpha: number = 1): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return hex
  const r = parseInt(result[1], 16)
  const g = parseInt(result[2], 16)
  const b = parseInt(result[3], 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function colorChannels(color: string): string {
  const hex = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color)
  if (hex) {
    return `${parseInt(hex[1], 16)} ${parseInt(hex[2], 16)} ${parseInt(hex[3], 16)}`
  }

  const functional = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color)
  if (functional) return `${functional[1]} ${functional[2]} ${functional[3]}`

  return "0 0 0"
}

// Lighten/darken color helper
function adjustColor(hex: string, amount: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return hex
  let r = parseInt(result[1], 16) + amount
  let g = parseInt(result[2], 16) + amount
  let b = parseInt(result[3], 16) + amount
  r = Math.max(0, Math.min(255, r))
  g = Math.max(0, Math.min(255, g))
  b = Math.max(0, Math.min(255, b))
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

// Resolve a color value (handles defs references, variants, hex)
function resolveColor(
  value: string | ThemeColorVariant | undefined,
  defs: Record<string, string>,
  themeData: Record<string, string | ThemeColorVariant | undefined>,
  mode: "dark" | "light",
): string {
  if (!value) return "#000000"

  // Handle variant object
  if (typeof value === "object" && "dark" in value) {
    return resolveColor(value[mode], defs, themeData, mode)
  }

  // Handle string
  if (typeof value === "string") {
    // Direct hex color
    if (value.startsWith("#")) return value

    // Check defs first
    if (defs[value]) return resolveColor(defs[value], defs, themeData, mode)

    // Check theme colors
    if (themeData[value]) return resolveColor(themeData[value], defs, themeData, mode)

    return value
  }

  return "#000000"
}

// Resolve complete theme for a mode
function resolveThemeColors(theme: ThemeJson, mode: "dark" | "light"): ThemeColors {
  const defs = theme.defs ?? {}
  const themeData = theme.theme

  // Resolve all colors
  const primary = resolveColor(themeData.primary, defs, themeData, mode)
  const secondary = resolveColor(themeData.secondary, defs, themeData, mode)
  const accent = resolveColor(themeData.accent, defs, themeData, mode)
  const error = resolveColor(themeData.error, defs, themeData, mode)
  const warning = resolveColor(themeData.warning, defs, themeData, mode)
  const success = resolveColor(themeData.success, defs, themeData, mode)
  const info = resolveColor(themeData.info, defs, themeData, mode)
  const text = resolveColor(themeData.text, defs, themeData, mode)
  const textMuted = resolveColor(themeData.textMuted, defs, themeData, mode)
  const background = resolveColor(themeData.background, defs, themeData, mode)
  const backgroundPanel = resolveColor(themeData.backgroundPanel, defs, themeData, mode)
  const backgroundElement = resolveColor(themeData.backgroundElement, defs, themeData, mode)
  const border = resolveColor(themeData.border, defs, themeData, mode)
  const borderActive = resolveColor(themeData.borderActive, defs, themeData, mode)
  const borderSubtle = resolveColor(themeData.borderSubtle, defs, themeData, mode)

  // Diff colors
  const diffAdded = resolveColor(themeData.diffAdded, defs, themeData, mode)
  const diffRemoved = resolveColor(themeData.diffRemoved, defs, themeData, mode)
  const diffContext = resolveColor(themeData.diffContext, defs, themeData, mode)
  const diffHunkHeader = resolveColor(themeData.diffHunkHeader, defs, themeData, mode)
  const diffHighlightAdded = resolveColor(themeData.diffHighlightAdded, defs, themeData, mode)
  const diffHighlightRemoved = resolveColor(themeData.diffHighlightRemoved, defs, themeData, mode)
  const diffAddedBg = resolveColor(themeData.diffAddedBg, defs, themeData, mode)
  const diffRemovedBg = resolveColor(themeData.diffRemovedBg, defs, themeData, mode)
  const diffContextBg = resolveColor(themeData.diffContextBg, defs, themeData, mode)
  const diffLineNumber = resolveColor(themeData.diffLineNumber, defs, themeData, mode)
  const diffAddedLineNumberBg = resolveColor(themeData.diffAddedLineNumberBg, defs, themeData, mode)
  const diffRemovedLineNumberBg = resolveColor(themeData.diffRemovedLineNumberBg, defs, themeData, mode)

  // Markdown colors
  const markdownText = resolveColor(themeData.markdownText, defs, themeData, mode)
  const markdownHeading = resolveColor(themeData.markdownHeading, defs, themeData, mode)
  const markdownLink = resolveColor(themeData.markdownLink, defs, themeData, mode)
  const markdownLinkText = resolveColor(themeData.markdownLinkText, defs, themeData, mode)
  const markdownCode = resolveColor(themeData.markdownCode, defs, themeData, mode)
  const markdownBlockQuote = resolveColor(themeData.markdownBlockQuote, defs, themeData, mode)
  const markdownEmph = resolveColor(themeData.markdownEmph, defs, themeData, mode)
  const markdownStrong = resolveColor(themeData.markdownStrong, defs, themeData, mode)
  const markdownHorizontalRule = resolveColor(themeData.markdownHorizontalRule, defs, themeData, mode)
  const markdownListItem = resolveColor(themeData.markdownListItem, defs, themeData, mode)
  const markdownListEnumeration = resolveColor(themeData.markdownListEnumeration, defs, themeData, mode)
  const markdownImage = resolveColor(themeData.markdownImage, defs, themeData, mode)
  const markdownImageText = resolveColor(themeData.markdownImageText, defs, themeData, mode)
  const markdownCodeBlock = resolveColor(themeData.markdownCodeBlock, defs, themeData, mode)

  // Syntax colors
  const syntaxComment = resolveColor(themeData.syntaxComment, defs, themeData, mode)
  const syntaxKeyword = resolveColor(themeData.syntaxKeyword, defs, themeData, mode)
  const syntaxFunction = resolveColor(themeData.syntaxFunction, defs, themeData, mode)
  const syntaxVariable = resolveColor(themeData.syntaxVariable, defs, themeData, mode)
  const syntaxString = resolveColor(themeData.syntaxString, defs, themeData, mode)
  const syntaxNumber = resolveColor(themeData.syntaxNumber, defs, themeData, mode)
  const syntaxType = resolveColor(themeData.syntaxType, defs, themeData, mode)
  const syntaxOperator = resolveColor(themeData.syntaxOperator, defs, themeData, mode)
  const syntaxPunctuation = resolveColor(themeData.syntaxPunctuation, defs, themeData, mode)

  // Derive mobile-specific colors from theme
  const isDark = mode === "dark"
  const surface = isDark ? backgroundPanel : adjustColor(background, 8)
  const surfaceMuted = backgroundPanel
  const surfaceRaised = isDark ? backgroundElement : adjustColor(background, 8)
  const panel = backgroundPanel
  const ink = text
  const soft = textMuted
  const muted = textMuted
  const accentLight = isDark ? adjustColor(accent, 30) : adjustColor(accent, -20)
  const warn = warning
  const danger = error
  const critical = error
  const focusRing = hexToRgba(accent, isDark ? 0.35 : 0.25)
  const shadowSoft = isDark ? "rgba(0, 0, 0, 0.3)" : "rgba(15, 23, 42, 0.08)"
  const shadowStrong = isDark ? "rgba(0, 0, 0, 0.5)" : "rgba(15, 23, 42, 0.16)"
  const tabBackground = background
  const tabSurface = backgroundPanel
  const tabStatus = isDark ? adjustColor(background, 20) : adjustColor(background, -15)
  const shadow = isDark ? "#000000" : "#94a3b8"
  const codeBackground = isDark ? adjustColor(background, -30) : adjustColor(background, 40)
  const codeText = syntaxString
  const codeBlockBackground = isDark ? "#1e1e1e" : adjustColor(background, -20)
  const codeAccent = accent
  const reasoningBackground = isDark ? adjustColor(background, 30) : adjustColor(background, -20)
  const userBubble = isDark ? adjustColor(primary, 20) : primary
  const assistantBubble = background

  return {
    primary,
    secondary,
    accent,
    error,
    warning,
    success,
    info,
    text,
    textMuted,
    background,
    backgroundPanel,
    backgroundElement,
    border,
    borderActive,
    borderSubtle,
    diffAdded,
    diffRemoved,
    diffContext,
    diffHunkHeader,
    diffHighlightAdded,
    diffHighlightRemoved,
    diffAddedBg,
    diffRemovedBg,
    diffContextBg,
    diffLineNumber,
    diffAddedLineNumberBg,
    diffRemovedLineNumberBg,
    markdownText,
    markdownHeading,
    markdownLink,
    markdownLinkText,
    markdownCode,
    markdownBlockQuote,
    markdownEmph,
    markdownStrong,
    markdownHorizontalRule,
    markdownListItem,
    markdownListEnumeration,
    markdownImage,
    markdownImageText,
    markdownCodeBlock,
    syntaxComment,
    syntaxKeyword,
    syntaxFunction,
    syntaxVariable,
    syntaxString,
    syntaxNumber,
    syntaxType,
    syntaxOperator,
    syntaxPunctuation,
    // Mobile-specific
    surface,
    surfaceMuted,
    surfaceRaised,
    panel,
    ink,
    soft,
    muted,
    accentLight,
    warn,
    danger,
    critical,
    focusRing,
    shadowSoft,
    shadowStrong,
    tabBackground,
    tabSurface,
    tabStatus,
    shadow,
    codeBackground,
    codeText,
    codeBlockBackground,
    codeAccent,
    reasoningBackground,
    userBubble,
    assistantBubble,
  }
}

// Legacy palette format for backwards compatibility
export const palettes = {
  light: {
    background: "#f7f6f2",
    surface: "#ffffff",
    surfaceMuted: "#f2f0eb",
    surfaceRaised: "#ffffff",
    panel: "#efede8",
    border: "#dad8d1",
    ink: "#141413",
    soft: "#5a5954",
    muted: "#75746e",
    accent: "#141413",
    accentLight: "#141413",
    warn: "#c06e2e",
    warning: "#c06e2e",
    success: "#1f8a65",
    danger: "#cf2d56",
    critical: "#cf2d56",
    focusRing: "rgba(20, 20, 19, 0.25)",
    shadowSoft: "rgba(20, 20, 19, 0.06)",
    shadowStrong: "rgba(20, 20, 19, 0.14)",
    tabBackground: "#f7f6f2",
    tabSurface: "#ffffff",
    tabStatus: "#efede8",
    shadow: "#a8a69f",
    codeBackground: "#efede8",
    codeText: "#141413",
    codeBlockBackground: "#1e1e1e",
    codeAccent: "#3b82f6",
    reasoningBackground: "#f2f0eb",
    userBubble: "#f0eee8",
    assistantBubble: "#ffffff",
  },
  dark: {
    background: "#000000",
    surface: "#111111",
    surfaceMuted: "#171717",
    surfaceRaised: "#1d1d1d",
    panel: "#181818",
    border: "#262626",
    ink: "#f0f0f0",
    soft: "#b8b8b8",
    muted: "#7a7a7a",
    accent: "#e8e8e8",
    accentLight: "#ffffff",
    warn: "#fbbf24",
    warning: "#fbbf24",
    success: "#34d399",
    danger: "#fb7185",
    critical: "#fb7185",
    focusRing: "rgba(255, 255, 255, 0.26)",
    shadowSoft: "rgba(0, 0, 0, 0.32)",
    shadowStrong: "rgba(0, 0, 0, 0.52)",
    tabBackground: "#000000",
    tabSurface: "#111111",
    tabStatus: "#181818",
    shadow: "#000000",
    codeBackground: "#0f0f0f",
    codeText: "#e8e8e8",
    codeBlockBackground: "#1e1e1e",
    codeAccent: "#93c5fd",
    reasoningBackground: "#181818",
    userBubble: "#262626",
    assistantBubble: "#171717",
  },
} as const

export type AppPalette = (typeof palettes)[keyof typeof palettes]

// Glass-specific tokens for expo-glass-effect
export const glassTokens = {
  light: {
    glassShell: "rgba(255, 255, 255, 0.72)",
    glassShellStrong: "rgba(255, 255, 255, 0.85)",
    glassPanel: "rgba(239, 237, 232, 0.68)",
    glassPanelStrong: "rgba(239, 237, 232, 0.82)",
    glassBorder: "rgba(255, 255, 255, 0.18)",
    glassBorderStrong: "rgba(255, 255, 255, 0.28)",
    glassShadow: "rgba(0, 0, 0, 0.06)",
    glassShadowStrong: "rgba(0, 0, 0, 0.1)",
    glassScrim: "rgba(0, 0, 0, 0.025)",
    glassTintAccent: "rgba(20, 20, 19, 0.06)",
    glassTintAccentStrong: "rgba(20, 20, 19, 0.12)",
  },
  dark: {
    glassShell: "rgba(17, 17, 17, 0.72)",
    glassShellStrong: "rgba(17, 17, 17, 0.85)",
    glassPanel: "rgba(24, 24, 24, 0.68)",
    glassPanelStrong: "rgba(24, 24, 24, 0.82)",
    glassBorder: "rgba(255, 255, 255, 0.1)",
    glassBorderStrong: "rgba(255, 255, 255, 0.18)",
    glassShadow: "rgba(0, 0, 0, 0.3)",
    glassShadowStrong: "rgba(0, 0, 0, 0.45)",
    glassScrim: "rgba(0, 0, 0, 0.18)",
    glassTintAccent: "rgba(255, 255, 255, 0.08)",
    glassTintAccentStrong: "rgba(255, 255, 255, 0.14)",
  },
} as const

export type GlassTokens = (typeof glassTokens)[keyof typeof glassTokens]

// Theme context type
type ThemeContextType = {
  themeId: string
  themeName: string
  colors: ThemeColors
  palette: ThemeColors
  glass: GlassTokens
  colorScheme: "light" | "dark"
  isDark: boolean
  setTheme: (themeId: string) => void
  setColorScheme: (scheme: "light" | "dark" | "system") => void
  availableThemes: ThemeInfo[]
}

const ThemeContext = createContext<ThemeContextType | null>(null)

// Default theme
const DEFAULT_THEME = "nikcli"
const DEFAULT_COLOR_SCHEME = "system"

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { colorScheme: systemColorScheme } = useColorScheme()
  const systemScheme = systemColorScheme === "light" ? "light" : "dark"

  const [themeId, setThemeId] = useState(DEFAULT_THEME)
  const [colorSchemePreference, setColorSchemePreference] = useState<"light" | "dark" | "system">(DEFAULT_COLOR_SCHEME)
  const [isLoaded, setIsLoaded] = useState(false)

  // Load saved preferences
  // Note: themeId/colorSchemePreference are populated asynchronously from
  // SecureStore, which can't run during a useState lazy initializer.
  // The "isLoaded" gate below prevents rendering with stale defaults
  // before storage has been read. This is the standard React Native
  // pattern for persisted UI preferences.
  // oxlint-disable-next-line react-doctor/no-initialize-state
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const preferences = await getThemePreferences()
        if (preferences.themeId && THEMES[preferences.themeId]) {
          setThemeId(preferences.themeId)
        }
        if (preferences.colorScheme) {
          setColorSchemePreference(preferences.colorScheme)
        }
      } catch (error) {
        console.warn("Failed to load theme preferences:", error)
      } finally {
        setIsLoaded(true)
      }
    }
    loadPreferences()
  }, [])

  // Determine effective color scheme
  const colorScheme = colorSchemePreference === "system" ? systemScheme : colorSchemePreference
  const isDark = colorScheme === "dark"

  // Resolve theme colors
  const theme = useMemo(() => {
    const themeJson = THEMES[themeId] ?? THEMES.nikcli
    return resolveThemeColors(themeJson, colorScheme)
  }, [themeId, colorScheme])

  const glass = isDark ? glassTokens.dark : glassTokens.light
  const themeVariables = useMemo(
    () =>
      vars({
        "--color-background": colorChannels(theme.background),
        "--color-surface": colorChannels(theme.surface),
        "--color-panel": colorChannels(theme.panel),
        "--color-border": colorChannels(theme.border),
        "--color-accent": colorChannels(theme.accent),
        "--color-accent-strong": colorChannels(theme.primary),
        "--color-accent-light": colorChannels(theme.accentLight),
        "--color-muted": colorChannels(theme.muted),
        "--color-ink": colorChannels(theme.ink),
        "--color-soft": colorChannels(theme.soft),
        "--color-user-bubble": colorChannels(theme.userBubble),
        "--color-assistant-bubble": colorChannels(theme.assistantBubble),
        "--color-success": colorChannels(theme.success),
        "--color-danger": colorChannels(theme.danger),
        "--color-warning": colorChannels(theme.warning),
        "--color-info": colorChannels(theme.info),
        "--color-focus-ring": colorChannels(theme.accent),
        "--color-glass-shell": colorChannels(glass.glassShell),
        "--color-glass-shell-strong": colorChannels(glass.glassShellStrong),
        "--color-glass-panel": colorChannels(glass.glassPanel),
        "--color-glass-border": colorChannels(glass.glassBorder),
        "--color-glass-border-strong": colorChannels(glass.glassBorderStrong),
        "--color-glass-shadow": colorChannels(glass.glassShadow),
        "--color-glass-scrim": colorChannels(glass.glassScrim),
        "--color-glass-tint-accent": colorChannels(glass.glassTintAccent),
        "--color-overlay": colorChannels(isDark ? "#000000" : theme.ink),
      }),
    [glass, isDark, theme],
  )

  const setTheme = async (newThemeId: string) => {
    if (THEMES[newThemeId]) {
      setThemeId(newThemeId)
      try {
        await setStoredTheme(newThemeId)
      } catch (error) {
        console.warn("Failed to save theme preference:", error)
      }
    }
  }

  const setColorScheme = async (scheme: "light" | "dark" | "system") => {
    setColorSchemePreference(scheme)
    try {
      await setStoredColorScheme(scheme)
    } catch (error) {
      console.warn("Failed to save color scheme preference:", error)
    }
  }

  const themeName = THEME_LIST.find((t) => t.id === themeId)?.name ?? themeId

  const value: ThemeContextType = {
    themeId,
    themeName,
    colors: theme,
    palette: theme, // Use full theme colors as palette for backwards compatibility
    glass,
    colorScheme,
    isDark,
    setTheme,
    setColorScheme,
    availableThemes: THEME_LIST,
  }

  // Don't render until loaded to prevent flash
  if (!isLoaded) {
    return null
  }

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}

// Legacy hooks for backwards compatibility
export function useAppTheme() {
  const { palette, glass, colorScheme, isDark } = useTheme()
  return {
    colorScheme,
    isDark,
    palette,
    glass,
  }
}

// Export theme utilities
export { resolveThemeColors, hexToRgba, adjustColor }
