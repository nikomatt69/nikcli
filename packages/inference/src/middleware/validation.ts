import { z } from "zod"

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
})

const toolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
})

export const chatCompletionsSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().max(200_000).optional(),
  stream: z.boolean().optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: z.union([z.string(), z.object({}).passthrough()]).optional(),
  response_format: z.object({ type: z.string() }).passthrough().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  seed: z.number().int().optional(),
  user: z.string().optional(),
  nikcli: z
    .object({
      cache: z.boolean().optional(),
      cacheTtlSeconds: z.number().int().positive().optional(),
      preferProvider: z.string().optional(),
      allowEstimated: z.boolean().optional(),
    })
    .optional(),
})

export type ChatCompletionsBody = z.infer<typeof chatCompletionsSchema>

export function validateChatBody(
  input: unknown,
): { ok: true; data: ChatCompletionsBody } | { ok: false; error: string } {
  const result = chatCompletionsSchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  return {
    ok: false,
    error: result.error.errors.map((e) => `${e.path.join(".") || "<root>"}: ${e.message}`).join("; "),
  }
}
