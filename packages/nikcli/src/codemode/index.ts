// Ported from @opencode-ai/codemode (github.com/anomalyco/opencode, branch v2, MIT).
// Confined code execution over schema-described tools: programs run in a pure
// interpreter with no ambient authority; every effect goes through `tools.*`.
export * as CodeMode from "./codemode"
export * as Tool from "./tool"
export { ToolError, toolError } from "./tool-error"
