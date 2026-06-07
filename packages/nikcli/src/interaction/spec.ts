import { Schema } from "effect"
import { zod } from "@/util/effect-zod"

// ──────────────────────────────────────────────────────────────────────────
// Interactive TUI mini-app spec.
//
// Declarative-only by design: the model never writes event-handler code. It
// declares widgets bound to a flat `state` record (keyed by widget `id`) and
// buttons that carry *declarative* actions. The renderer owns all interaction;
// the agent gets the final `state` back when the user submits. This keeps the
// surface validatable (discriminated unions + bounded shapes) so the model
// fails far less than it would emitting free-form UI code.
// ──────────────────────────────────────────────────────────────────────────

const ColorToken = Schema.Literals([
  "default",
  "primary",
  "secondary",
  "accent",
  "success",
  "warning",
  "error",
  "info",
  "muted",
])

const Severity = Schema.Literals(["info", "success", "warning", "error"])

/** A single value a widget can read/write in the shared state record. */
export const StateValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)])

/** The shared state record: widget id → value. */
export const StateSchema = Schema.Record(Schema.String, StateValue)

const Option = Schema.Struct({
  value: Schema.String.annotate({ description: "Stored value written to state when chosen." }),
  label: Schema.optional(Schema.String).annotate({ description: "Display text. Defaults to `value`." }),
})

// ──────────────────────────────────────────────────────────────────────────
// Interactive widgets (each binds a state key via `id`)
// ──────────────────────────────────────────────────────────────────────────

const TextInput = Schema.Struct({
  type: Schema.Literal("text_input"),
  id: Schema.String.annotate({ description: "State key this input reads/writes." }),
  label: Schema.String,
  placeholder: Schema.optional(Schema.String),
  default: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String).annotate({ description: "One-line hint under the field." }),
})

const TextArea = Schema.Struct({
  type: Schema.Literal("textarea"),
  id: Schema.String,
  label: Schema.String,
  placeholder: Schema.optional(Schema.String),
  default: Schema.optional(Schema.String),
  rows: Schema.optional(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(2)), Schema.check(Schema.isLessThanOrEqualTo(20))),
  ),
  help: Schema.optional(Schema.String),
})

const NumberInput = Schema.Struct({
  type: Schema.Literal("number_input"),
  id: Schema.String,
  label: Schema.String,
  default: Schema.optional(Schema.Number),
  min: Schema.optional(Schema.Number),
  max: Schema.optional(Schema.Number),
  step: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0)))),
  help: Schema.optional(Schema.String),
})

const Select = Schema.Struct({
  type: Schema.Literal("select"),
  id: Schema.String,
  label: Schema.String,
  options: Schema.Array(Option).pipe(Schema.check(Schema.isMinLength(1))),
  default: Schema.optional(Schema.String).annotate({ description: "Pre-selected option value." }),
  help: Schema.optional(Schema.String),
})

const MultiSelect = Schema.Struct({
  type: Schema.Literal("multiselect"),
  id: Schema.String,
  label: Schema.String,
  options: Schema.Array(Option).pipe(Schema.check(Schema.isMinLength(1))),
  default: Schema.optional(Schema.Array(Schema.String)).annotate({ description: "Pre-selected option values." }),
  help: Schema.optional(Schema.String),
})

const Checkbox = Schema.Struct({
  type: Schema.Literal("checkbox"),
  id: Schema.String,
  label: Schema.String,
  default: Schema.optional(Schema.Boolean),
  help: Schema.optional(Schema.String),
})

const Radio = Schema.Struct({
  type: Schema.Literal("radio"),
  id: Schema.String,
  label: Schema.String,
  options: Schema.Array(Option).pipe(Schema.check(Schema.isMinLength(2))),
  default: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String),
})

const Slider = Schema.Struct({
  type: Schema.Literal("slider"),
  id: Schema.String,
  label: Schema.String,
  min: Schema.Number,
  max: Schema.Number,
  step: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0)))),
  default: Schema.optional(Schema.Number),
  unit: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String),
})

// ──────────────────────────────────────────────────────────────────────────
// Button — the only widget that *does* something, via a declarative action.
// ──────────────────────────────────────────────────────────────────────────

const ButtonAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("close"),
  }).annotate({ description: "Close the panel (use for Done/Cancel buttons)." }),
  Schema.Struct({
    kind: Schema.Literal("submit"),
  }).annotate({ description: "Alias for close." }),
  Schema.Struct({
    kind: Schema.Literal("cancel"),
  }).annotate({ description: "Alias for close." }),
  Schema.Struct({
    kind: Schema.Literal("goto"),
    screen: Schema.String.annotate({ description: "Target screen `id` to navigate to." }),
  }).annotate({ description: "Navigate to another screen (multi-screen mini-app)." }),
  Schema.Struct({
    kind: Schema.Literal("set"),
    target: Schema.String.annotate({ description: "State key to write." }),
    value: StateValue,
  }).annotate({ description: "Write a fixed value into state." }),
  Schema.Struct({
    kind: Schema.Literal("toggle"),
    target: Schema.String.annotate({ description: "Boolean state key to flip." }),
  }).annotate({ description: "Flip a boolean state key." }),
]).annotate({ discriminator: "kind" })

const Button = Schema.Struct({
  type: Schema.Literal("button"),
  label: Schema.String,
  action: ButtonAction,
  variant: Schema.optional(Schema.Literals(["primary", "secondary", "danger"])).annotate({
    description: "Visual emphasis. Use `danger` for destructive actions, `primary` for the main call to action.",
  }),
})

// ──────────────────────────────────────────────────────────────────────────
// Display widgets (read-only, may interpolate state via {{key}} in text)
// ──────────────────────────────────────────────────────────────────────────

const Heading = Schema.Struct({
  type: Schema.Literal("heading"),
  text: Schema.String,
})

const Text = Schema.Struct({
  type: Schema.Literal("text"),
  content: Schema.String.annotate({
    description: "Plain text. `{{stateKey}}` is replaced live with the current value of that state key.",
  }),
  color: Schema.optional(ColorToken),
})

const Markdown = Schema.Struct({
  type: Schema.Literal("markdown"),
  content: Schema.String.annotate({ description: "GitHub-flavored markdown. `{{stateKey}}` is interpolated live." }),
})

const Alert = Schema.Struct({
  type: Schema.Literal("alert"),
  severity: Severity,
  title: Schema.optional(Schema.String),
  message: Schema.String,
})

const Divider = Schema.Struct({
  type: Schema.Literal("divider"),
  label: Schema.optional(Schema.String),
})

// ──────────────────────────────────────────────────────────────────────────
// Leaf union + one level of layout containers
// ──────────────────────────────────────────────────────────────────────────

const leafWidgets = [
  TextInput,
  TextArea,
  NumberInput,
  Select,
  MultiSelect,
  Checkbox,
  Radio,
  Slider,
  Button,
  Heading,
  Text,
  Markdown,
  Alert,
  Divider,
] as const

const LeafWidget = Schema.Union([...leafWidgets]).annotate({ discriminator: "type" })

const Row = Schema.Struct({
  type: Schema.Literal("row"),
  children: Schema.Array(LeafWidget).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(6))),
}).annotate({ description: "Lay children side-by-side on one line (e.g. a Cancel/Submit button pair)." })

const Group = Schema.Struct({
  type: Schema.Literal("group"),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  children: Schema.Array(Schema.Union([...leafWidgets, Row]).annotate({ discriminator: "type" })).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(20)),
  ),
}).annotate({ description: "A titled cluster of related widgets." })

const BodyComponent = Schema.Union([...leafWidgets, Row, Group]).annotate({ discriminator: "type" })

// ──────────────────────────────────────────────────────────────────────────
// Screens + app
// ──────────────────────────────────────────────────────────────────────────

const Screen = Schema.Struct({
  id: Schema.String.annotate({ description: "Unique screen id, referenced by button `goto` actions." }),
  title: Schema.optional(Schema.String),
  body: Schema.Array(BodyComponent).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(30))),
})

export const AppSpec = Schema.Struct({
  title: Schema.String.annotate({ description: "App title shown in the dialog header." }),
  subtitle: Schema.optional(Schema.String),
  state: Schema.optional(Schema.Record(Schema.String, StateValue)).annotate({
    description:
      "Initial state, keyed by widget `id`. Widget-level `default` fields also seed state; this is for keys not owned by a single widget (e.g. used only via {{interpolation}} or `set`/`toggle`).",
  }),
  screens: Schema.Array(Screen)
    .pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(8)))
    .annotate({
      description: "One screen for a simple form; multiple screens (navigated via button `goto`) for a mini-app.",
    }),
})

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

export type AppSpecType = Schema.Schema.Type<typeof AppSpec>
export type WidgetLeaf = Schema.Schema.Type<typeof LeafWidget>
export type BodyComponentType = Schema.Schema.Type<typeof BodyComponent>
export type ScreenType = Schema.Schema.Type<typeof Screen>
export type ButtonActionType = Schema.Schema.Type<typeof ButtonAction>
export type StateValueType = Schema.Schema.Type<typeof StateValue>
export type OptionType = Schema.Schema.Type<typeof Option>
export type InteractionColor = Schema.Schema.Type<typeof ColorToken>
export type InteractionSeverity = Schema.Schema.Type<typeof Severity>

/** Zod form of the spec — used as the tool's parameters and the HTTP payload. */
export const AppSpecZod = zod(AppSpec)
