import { z } from "zod"

export const PROTOCOL_VERSION = 1 as const
export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION)

const IdSchema = z.string().min(1).max(256)
const NonEmptyTextSchema = z.string().min(1)
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

export const SurfaceIdSchema = IdSchema
export const SurfaceKindSchema = z.enum(["dialog", "popover", "notification", "menu"])
export const ControlIdSchema = IdSchema
export const ControlTypeSchema = z.enum(["button", "link", "text-input", "select", "checkbox", "progress", "separator"])

export const ControlSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("button"),
    id: ControlIdSchema,
    label: NonEmptyTextSchema,
    action: IdSchema,
    disabled: z.boolean().optional(),
    destructive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("link"),
    id: ControlIdSchema,
    label: NonEmptyTextSchema,
    url: z.string().url(),
    disabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("text-input"),
    id: ControlIdSchema,
    label: NonEmptyTextSchema.optional(),
    value: z.string().optional(),
    placeholder: z.string().optional(),
    secure: z.boolean().optional(),
    multiline: z.boolean().optional(),
    required: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("select"),
    id: ControlIdSchema,
    label: NonEmptyTextSchema,
    value: IdSchema.optional(),
    options: z
      .array(
        z.object({
          id: IdSchema,
          label: NonEmptyTextSchema,
          disabled: z.boolean().optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    type: z.literal("checkbox"),
    id: ControlIdSchema,
    label: NonEmptyTextSchema,
    checked: z.boolean(),
    disabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("progress"),
    id: ControlIdSchema,
    label: NonEmptyTextSchema.optional(),
    value: z.number().min(0).max(1),
    detail: z.string().optional(),
    indeterminate: z.boolean().optional(),
  }),
  z.object({ type: z.literal("separator"), id: ControlIdSchema.optional() }),
])

export const SurfaceBaseSchema = z.object({
  id: SurfaceIdSchema,
  title: NonEmptyTextSchema,
  body: z.string().optional(),
  controls: z.array(ControlSchema).default([]),
  dismissible: z.boolean().default(true),
  metadata: z.record(z.string(), JsonValueSchema).optional(),
})

export const DialogSurfaceSchema = SurfaceBaseSchema.extend({
  kind: z.literal("dialog"),
  modal: z.boolean().default(true),
  width: z.enum(["small", "medium", "large"]).default("medium"),
})

export const PopoverSurfaceSchema = SurfaceBaseSchema.extend({
  kind: z.literal("popover"),
  anchor: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
  placement: z.enum(["top", "right", "bottom", "left"]).default("bottom"),
})

export const NotificationSurfaceSchema = SurfaceBaseSchema.extend({
  kind: z.literal("notification"),
  severity: z.enum(["info", "success", "warning", "error"]).default("info"),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
})

export const MenuSurfaceSchema = SurfaceBaseSchema.extend({
  kind: z.literal("menu"),
  items: z
    .array(
      z.object({
        id: IdSchema,
        label: NonEmptyTextSchema,
        action: IdSchema.optional(),
        disabled: z.boolean().optional(),
        checked: z.boolean().optional(),
      }),
    )
    .min(1),
})

export const SurfaceSchema = z.discriminatedUnion("kind", [
  DialogSurfaceSchema,
  PopoverSurfaceSchema,
  NotificationSurfaceSchema,
  MenuSurfaceSchema,
])

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dismiss-surface"), surfaceId: SurfaceIdSchema }),
  z.object({
    type: z.literal("invoke"),
    action: IdSchema,
    payload: z.record(z.string(), JsonValueSchema).optional(),
  }),
  z.object({ type: z.literal("open-url"), url: z.string().url() }),
  z.object({
    type: z.literal("update-control"),
    surfaceId: SurfaceIdSchema,
    controlId: ControlIdSchema,
    value: JsonValueSchema,
  }),
])

export const SurfaceEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("surface-opened"), surface: SurfaceSchema }),
  z.object({ type: z.literal("surface-updated"), surface: SurfaceSchema }),
  z.object({
    type: z.literal("surface-closed"),
    surfaceId: SurfaceIdSchema,
    reason: z.enum(["dismissed", "action", "replaced", "system"]),
  }),
  z.object({
    type: z.literal("control-activated"),
    surfaceId: SurfaceIdSchema,
    controlId: ControlIdSchema,
    action: ActionSchema,
  }),
  z.object({
    type: z.literal("control-changed"),
    surfaceId: SurfaceIdSchema,
    controlId: ControlIdSchema,
    value: JsonValueSchema,
  }),
])

export const CapabilitiesSchema = z.object({
  version: ProtocolVersionSchema,
  surfaces: z.array(SurfaceKindSchema).min(1),
  controls: z.array(ControlTypeSchema).min(1),
  actions: z.array(z.enum(["dismiss-surface", "invoke", "open-url", "update-control"])).min(1),
  maxSurfaces: z.number().int().positive().max(10_000).default(100),
})

export const TransportEnvelopeSchema = z.object({
  version: ProtocolVersionSchema,
  id: IdSchema,
  kind: z.enum(["request", "response", "event"]),
  method: IdSchema.optional(),
  payload: JsonValueSchema,
  error: z
    .object({
      code: IdSchema,
      message: NonEmptyTextSchema,
      details: JsonValueSchema.optional(),
    })
    .optional(),
})

export type Control = z.infer<typeof ControlSchema>
export type Surface = z.infer<typeof SurfaceSchema>
export type DialogSurface = z.infer<typeof DialogSurfaceSchema>
export type PopoverSurface = z.infer<typeof PopoverSurfaceSchema>
export type NotificationSurface = z.infer<typeof NotificationSurfaceSchema>
export type MenuSurface = z.infer<typeof MenuSurfaceSchema>
export type Action = z.infer<typeof ActionSchema>
export type SurfaceEvent = z.infer<typeof SurfaceEventSchema>
export type Capabilities = z.infer<typeof CapabilitiesSchema>
export type TransportEnvelope = z.infer<typeof TransportEnvelopeSchema>
