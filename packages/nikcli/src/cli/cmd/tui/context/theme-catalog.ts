import nikcli from "./theme/nikcli.json" with { type: "json" }

type JsonModule = { default: unknown }

/**
 * Lazy loaders with static specifiers so `bun compile` embeds the JSON.
 * `import.meta.glob` is bundler-only (undefined under `bun run`).
 * Calling a loader parses that document; evaluating this module does not.
 */
const LOADERS: Record<string, () => Promise<JsonModule>> = {
  abyss: () => import("./theme/abyss.json", { with: { type: "json" } }),
  apple: () => import("./theme/apple.json", { with: { type: "json" } }),
  arctic: () => import("./theme/arctic.json", { with: { type: "json" } }),
  aura: () => import("./theme/aura.json", { with: { type: "json" } }),
  ayu: () => import("./theme/ayu.json", { with: { type: "json" } }),
  ayuai: () => import("./theme/ayuai.json", { with: { type: "json" } }),
  blood: () => import("./theme/blood.json", { with: { type: "json" } }),
  brain: () => import("./theme/brain.json", { with: { type: "json" } }),
  carbonfox: () => import("./theme/carbonfox.json", { with: { type: "json" } }),
  catmoe: () => import("./theme/catmoe.json", { with: { type: "json" } }),
  catppuccin: () => import("./theme/catppuccin.json", { with: { type: "json" } }),
  "catppuccin-frappe": () => import("./theme/catppuccin-frappe.json", { with: { type: "json" } }),
  "catppuccin-latte": () => import("./theme/catppuccin-latte.json", { with: { type: "json" } }),
  "catppuccin-macchiato": () => import("./theme/catppuccin-macchiato.json", { with: { type: "json" } }),
  charcoal: () => import("./theme/charcoal.json", { with: { type: "json" } }),
  chromatic: () => import("./theme/chromatic.json", { with: { type: "json" } }),
  cobalt2: () => import("./theme/cobalt2.json", { with: { type: "json" } }),
  cosmic: () => import("./theme/cosmic.json", { with: { type: "json" } }),
  cursor: () => import("./theme/cursor.json", { with: { type: "json" } }),
  cyber: () => import("./theme/cyber.json", { with: { type: "json" } }),
  dawnfox: () => import("./theme/dawnfox.json", { with: { type: "json" } }),
  dim: () => import("./theme/shadow.json", { with: { type: "json" } }),
  dimension: () => import("./theme/dimension.json", { with: { type: "json" } }),
  dracula: () => import("./theme/dracula.json", { with: { type: "json" } }),
  "dracula-official": () => import("./theme/dracula-official.json", { with: { type: "json" } }),
  duo: () => import("./theme/duo.json", { with: { type: "json" } }),
  dusk: () => import("./theme/dusk.json", { with: { type: "json" } }),
  ebony: () => import("./theme/ebony.json", { with: { type: "json" } }),
  equilibrium: () => import("./theme/equilibrium.json", { with: { type: "json" } }),
  ethereal: () => import("./theme/ethereal.json", { with: { type: "json" } }),
  everforest: () => import("./theme/everforest.json", { with: { type: "json" } }),
  flexoki: () => import("./theme/flexoki.json", { with: { type: "json" } }),
  fusion: () => import("./theme/fusion.json", { with: { type: "json" } }),
  ghost: () => import("./theme/ghost.json", { with: { type: "json" } }),
  github: () => import("./theme/github.json", { with: { type: "json" } }),
  "github-dark": () => import("./theme/github-dark.json", { with: { type: "json" } }),
  "github-dimmed": () => import("./theme/github-dimmed.json", { with: { type: "json" } }),
  "github-light": () => import("./theme/github-light.json", { with: { type: "json" } }),
  glass: () => import("./theme/glass.json", { with: { type: "json" } }),
  gold: () => import("./theme/gold.json", { with: { type: "json" } }),
  gone: () => import("./theme/gone.json", { with: { type: "json" } }),
  greyscale: () => import("./theme/greyscale.json", { with: { type: "json" } }),
  gruvbox: () => import("./theme/gruvbox.json", { with: { type: "json" } }),
  hacker: () => import("./theme/hacker.json", { with: { type: "json" } }),
  holo: () => import("./theme/holo.json", { with: { type: "json" } }),
  ink: () => import("./theme/ink.json", { with: { type: "json" } }),
  jet: () => import("./theme/jet.json", { with: { type: "json" } }),
  kanagawa: () => import("./theme/kanagawa.json", { with: { type: "json" } }),
  lavender: () => import("./theme/lavender.json", { with: { type: "json" } }),
  lightph: () => import("./theme/lightph.json", { with: { type: "json" } }),
  "lucent-orng": () => import("./theme/lucent-orng.json", { with: { type: "json" } }),
  material: () => import("./theme/material.json", { with: { type: "json" } }),
  "material-ocean": () => import("./theme/material-ocean.json", { with: { type: "json" } }),
  matrix: () => import("./theme/matrix.json", { with: { type: "json" } }),
  mercury: () => import("./theme/mercury.json", { with: { type: "json" } }),
  midnight: () => import("./theme/midnight.json", { with: { type: "json" } }),
  modern: () => import("./theme/modern.json", { with: { type: "json" } }),
  monokai: () => import("./theme/monokai.json", { with: { type: "json" } }),
  muted: () => import("./theme/muted.json", { with: { type: "json" } }),
  neon: () => import("./theme/neon.json", { with: { type: "json" } }),
  neonfusion: () => import("./theme/neonfusion.json", { with: { type: "json" } }),
  neutral: () => import("./theme/neutral.json", { with: { type: "json" } }),
  nightowl: () => import("./theme/nightowl.json", { with: { type: "json" } }),
  nikcli: () => import("./theme/nikcli.json", { with: { type: "json" } }),
  nord: () => import("./theme/nord.json", { with: { type: "json" } }),
  nordic: () => import("./theme/nordic.json", { with: { type: "json" } }),
  nova: () => import("./theme/nova.json", { with: { type: "json" } }),
  obsidian: () => import("./theme/obsidian.json", { with: { type: "json" } }),
  "one-dark": () => import("./theme/one-dark.json", { with: { type: "json" } }),
  "one-pro": () => import("./theme/one-pro.json", { with: { type: "json" } }),
  onyx: () => import("./theme/onyx.json", { with: { type: "json" } }),
  orng: () => import("./theme/orng.json", { with: { type: "json" } }),
  "osaka-jade": () => import("./theme/osaka-jade.json", { with: { type: "json" } }),
  oxocarbon: () => import("./theme/oxocarbon.json", { with: { type: "json" } }),
  palenight: () => import("./theme/palenight.json", { with: { type: "json" } }),
  poimandres: () => import("./theme/poimandres.json", { with: { type: "json" } }),
  prism: () => import("./theme/prism.json", { with: { type: "json" } }),
  radiant: () => import("./theme/radiant.json", { with: { type: "json" } }),
  rosepine: () => import("./theme/rosepine.json", { with: { type: "json" } }),
  shadow: () => import("./theme/shadow.json", { with: { type: "json" } }),
  silicon: () => import("./theme/silicon.json", { with: { type: "json" } }),
  slate: () => import("./theme/slate.json", { with: { type: "json" } }),
  soft: () => import("./theme/soft.json", { with: { type: "json" } }),
  solarized: () => import("./theme/solarized.json", { with: { type: "json" } }),
  spectrum: () => import("./theme/spectrum.json", { with: { type: "json" } }),
  starlight: () => import("./theme/starlight.json", { with: { type: "json" } }),
  sunrise: () => import("./theme/sunrise.json", { with: { type: "json" } }),
  synthwave84: () => import("./theme/synthwave84.json", { with: { type: "json" } }),
  tech: () => import("./theme/tech.json", { with: { type: "json" } }),
  tokyonight: () => import("./theme/tokyonight.json", { with: { type: "json" } }),
  "tokyonight-storm": () => import("./theme/tokyonight-storm.json", { with: { type: "json" } }),
  vapor: () => import("./theme/vapor.json", { with: { type: "json" } }),
  vercel: () => import("./theme/vercel.json", { with: { type: "json" } }),
  vesper: () => import("./theme/vesper.json", { with: { type: "json" } }),
  vivid: () => import("./theme/vivid.json", { with: { type: "json" } }),
  void: () => import("./theme/void.json", { with: { type: "json" } }),
  vscode: () => import("./theme/vscode.json", { with: { type: "json" } }),
  zenburn: () => import("./theme/zenburn.json", { with: { type: "json" } }),
  zinc: () => import("./theme/zinc.json", { with: { type: "json" } }),
}

export const FALLBACK_THEME_ID = "nikcli" as const
export const FALLBACK_THEME = nikcli

export const BUILT_IN_THEME_IDS: readonly string[] = Object.freeze(
  Object.keys(LOADERS).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
)

const parsed = new Map<string, unknown>([[FALLBACK_THEME_ID, FALLBACK_THEME]])
const eagerParsedCount = parsed.size

export function isBuiltInTheme(id: string): boolean {
  return Object.hasOwn(LOADERS, id)
}

export function eagerParsedThemeIds(): readonly string[] {
  return [FALLBACK_THEME_ID]
}

export function eagerParsedThemeCount(): number {
  return eagerParsedCount
}

export async function loadBuiltInTheme(id: string): Promise<unknown | undefined> {
  const hit = parsed.get(id)
  if (hit !== undefined) return hit
  const load = LOADERS[id]
  if (!load) return undefined
  const mod = await load()
  parsed.set(id, mod.default)
  return mod.default
}
