import { z } from "zod"

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatar: z.string().optional(),
})

export const sessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "paused", "error"]),
  lastActivity: z.date(),
})

export const settingsSchema = z.object({
  language: z.string(),
  theme: z.enum(["light", "dark", "system"]),
  fontSize: z.number().min(8).max(32),
  fontFamily: z.string(),
  wordWrap: z.boolean(),
  tabSize: z.number(),
  showLineNumbers: z.boolean(),
  enableAI: z.boolean(),
  autoSave: z.boolean(),
})
