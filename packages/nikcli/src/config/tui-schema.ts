import z from "zod"
import { Config } from "./config"

const KeybindOverride = z
  .object(
    Object.fromEntries(Object.keys(Config.Keybinds.shape).map((key) => [key, z.string().optional()])) as Record<
      string,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict()

export const TuiOptions = z.object({
  scroll_speed: z.number().min(0.001).optional().describe("TUI scroll speed"),
  scroll_acceleration: z
    .object({
      enabled: z.boolean().describe("Enable scroll acceleration"),
    })
    .optional()
    .describe("Scroll acceleration settings"),
  diff_style: z
    .enum(["auto", "stacked"])
    .optional()
    .describe("Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column"),
  mouse: z.boolean().optional().describe("Enable or disable mouse capture (default: true)"),
  sound: z.boolean().optional().describe("Enable or disable ambient sound feedback (default: true)"),
  bg_pulse: z.boolean().optional().describe("Enable animated background pulse behind the home logo (default: false)"),
  turn_tokens: z
    .boolean()
    .optional()
    .describe(
      "Show a per-turn token breakdown after each answer, with a warning when the prompt cache is invalidated (default: false)",
    ),
  math: z
    .boolean()
    .optional()
    .describe(
      "Render LaTeX math in messages as Unicode formulas instead of raw source (default: true). Set to false to keep $…$ and $$…$$ as written.",
    ),
})

export const TuiInfo = z
  .object({
    $schema: z.string().optional(),
    theme: z.string().optional(),
    keybinds: KeybindOverride.optional(),
    plugin: Config.PluginSpec.array().optional(),
    plugin_enabled: z.record(z.string(), z.boolean()).optional(),
  })
  .extend(TuiOptions.shape)
  .strict()
