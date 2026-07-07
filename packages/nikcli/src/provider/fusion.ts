// OpenRouter "Fusion" (https://openrouter.ai/blog/announcements/fusion-beats-frontier/)
// is a meta-model that routes a request through several analysis models. It is
// exposed as selectable variants ("quality" / "budget") whose provider option
// carries the fusion plugin config; the leading analysis model is used as the
// primary `model`. These constants/helpers are shared with the TUI Fusion
// manager, so they live in their own module: the TUI can import them without
// evaluating the full transform/provider chain.
export const FUSION_NPM = "@openrouter/ai-sdk-provider"
export const FUSION_MODEL_ID = "openrouter/fusion"

/** Build a fusion variant value from analysis model slugs (primary defaults to the first). */
export function fusionPreset(analysisModels: readonly string[], model?: string): Record<string, any> {
  return {
    plugins: [{ id: "fusion", analysis_models: [...analysisModels], model: model ?? analysisModels[0] }],
  }
}

/** Built-in fusion presets shown (and toggleable) in the TUI Fusion manager. */
export const FUSION_BUILTIN_VARIANTS: Record<string, Record<string, any>> = {
  quality: fusionPreset(["~anthropic/claude-opus-latest", "~openai/gpt-latest", "~google/gemini-pro-latest"]),
  budget: fusionPreset(["~google/gemini-flash-latest", "~moonshotai/kimi-latest", "deepseek/deepseek-v4-pro"]),
}
