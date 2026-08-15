import { createStore } from "solid-js/store"
import { createMemo, For, Show, Switch, Match, onMount, type JSX } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useKeybind } from "../../context/keybind"
import { tint, useTheme } from "../../context/theme"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useDialog } from "../../ui/dialog"
import type {
  AppSpecType,
  BodyComponentType,
  WidgetLeaf,
  StateValueType,
  InteractionColor,
} from "@tui/util/interaction-spec"

type AnyWidget = Extract<BodyComponentType, { type: string }>

const FOCUSABLE = new Set([
  "text_input",
  "textarea",
  "number_input",
  "select",
  "multiselect",
  "checkbox",
  "radio",
  "slider",
  "button",
])

function isFocusable(w: { type: string }): boolean {
  return FOCUSABLE.has(w.type)
}

/** Walk a screen body (one level of row/group nesting) collecting focusable leaves in order. */
function collectFocusables(body: ReadonlyArray<BodyComponentType>): WidgetLeaf[] {
  const out: WidgetLeaf[] = []
  for (const comp of body) {
    if (comp.type === "row" || comp.type === "group") {
      for (const child of comp.children) {
        if (isFocusable(child)) out.push(child as WidgetLeaf)
      }
    } else if (isFocusable(comp)) {
      out.push(comp as WidgetLeaf)
    }
  }
  return out
}

function buildInitialState(spec: AppSpecType): Record<string, StateValueType> {
  const state: Record<string, StateValueType> = { ...((spec.state as Record<string, StateValueType>) ?? {}) }
  const seed = (w: AnyWidget) => {
    const id = (w as any).id as string | undefined
    if (!id) return
    if (state[id] !== undefined) return
    switch (w.type) {
      case "text_input":
      case "textarea":
        state[id] = (w as any).default ?? ""
        break
      case "number_input":
        state[id] = (w as any).default ?? (w as any).min ?? 0
        break
      case "slider":
        state[id] = (w as any).default ?? (w as any).min ?? 0
        break
      case "checkbox":
        state[id] = (w as any).default ?? false
        break
      case "select":
      case "radio":
        state[id] = (w as any).default ?? (w as any).options?.[0]?.value ?? ""
        break
      case "multiselect":
        state[id] = (w as any).default ?? []
        break
    }
  }
  for (const screen of spec.screens) {
    for (const comp of screen.body) {
      if (comp.type === "row" || comp.type === "group") comp.children.forEach((c) => seed(c as AnyWidget))
      else seed(comp as AnyWidget)
    }
  }
  return state
}

export function DialogInteractionApp(props: { spec: AppSpecType }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const keybind = useKeybind()
  const bindings = useTextareaKeybindings()
  const dialog = useDialog()

  const spec = createMemo(() => props.spec)

  const [store, setStore] = createStore({
    state: buildInitialState(spec()),
    screen: spec().screens[0]?.id ?? "",
    focus: 0,
    cursor: 0, // sub-cursor for multiselect option lists
    editing: false,
  })

  let textarea: TextareaRenderable | undefined

  const currentScreen = createMemo(() => spec().screens.find((s) => s.id === store.screen) ?? spec().screens[0])
  const focusables = createMemo(() => collectFocusables(currentScreen()?.body ?? []))
  const focusMap = createMemo(() => {
    const map = new Map<WidgetLeaf, number>()
    focusables().forEach((w, i) => map.set(w, i))
    return map
  })
  const focused = createMemo(() => focusables()[store.focus])

  function getVal(id: string): StateValueType | undefined {
    return store.state[id]
  }
  function setVal(id: string, value: StateValueType) {
    setStore("state", id as any, value)
  }

  function interpolate(text: string): string {
    return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
      const v = store.state[key]
      if (v === undefined) return ""
      return Array.isArray(v) ? v.join(", ") : String(v)
    })
  }

  function gotoScreen(id: string) {
    if (!spec().screens.some((s) => s.id === id)) return
    setStore("screen", id)
    setStore("focus", 0)
    setStore("cursor", 0)
  }

  onMount(() => dialog.setSize("large"))

  // Interaction is local — closing the panel just dismisses it (like opentui's
  // viz dialog). submit/cancel both close; the prompt area underneath is never
  // touched, so it's still there when the panel closes.
  const close = () => dialog.clear()

  function dispatch(action: any) {
    switch (action?.kind) {
      case "close":
      case "submit":
      case "cancel":
        close()
        break
      case "goto":
        gotoScreen(action.screen)
        break
      case "set":
        setVal(action.target, action.value)
        break
      case "toggle":
        setVal(action.target, !getVal(action.target))
        break
    }
  }

  function moveFocus(delta: number) {
    const n = focusables().length
    if (n === 0) return
    setStore("focus", (store.focus + delta + n) % n)
    setStore("cursor", 0)
  }

  function cycleOption(w: any, delta: number) {
    const opts = w.options ?? []
    if (opts.length === 0) return
    const cur = opts.findIndex((o: any) => o.value === getVal(w.id))
    const next = (cur < 0 ? 0 : cur + delta + opts.length) % opts.length
    setVal(w.id, opts[next].value)
  }

  function adjustSlider(w: any, dir: number) {
    const step = w.step ?? 1
    const cur = Number(getVal(w.id) ?? w.min ?? 0)
    let next = cur + dir * step
    if (typeof w.min === "number") next = Math.max(w.min, next)
    if (typeof w.max === "number") next = Math.min(w.max, next)
    setVal(w.id, next)
  }

  function toggleMulti(w: any, optValue: string) {
    const cur = Array.isArray(getVal(w.id)) ? [...(getVal(w.id) as string[])] : []
    const idx = cur.indexOf(optValue)
    if (idx === -1) cur.push(optValue)
    else cur.splice(idx, 1)
    setVal(w.id, cur)
  }

  function commitEdit() {
    const w = focused() as any
    if (!w || !textarea) return
    const text = textarea.plainText ?? ""
    if (w.type === "number_input") {
      const num = Number(text.trim())
      setVal(w.id, Number.isFinite(num) ? num : (w.min ?? 0))
    } else {
      setVal(w.id, text)
    }
    setStore("editing", false)
  }

  useKeyboard((evt) => {
    const w = focused() as any

    if (store.editing) {
      if (evt.name === "escape") {
        evt.preventDefault()
        evt.stopPropagation()
        setStore("editing", false)
        return
      }
      if (evt.name === "return" || evt.name === "tab") {
        evt.preventDefault()
        commitEdit()
        if (evt.name === "tab") moveFocus(evt.shift ? -1 : 1)
        return
      }
      return // textarea handles the rest
    }

    // global
    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      close()
      return
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      moveFocus(evt.shift ? -1 : 1)
      return
    }

    const isMulti = w?.type === "multiselect"

    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      if (isMulti) {
        const len = w.options?.length ?? 0
        if (len) setStore("cursor", (store.cursor - 1 + len) % len)
      } else moveFocus(-1)
      return
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      if (isMulti) {
        const len = w.options?.length ?? 0
        if (len) setStore("cursor", (store.cursor + 1) % len)
      } else moveFocus(1)
      return
    }

    if (evt.name === "left" || evt.name === "h") {
      if (w?.type === "select" || w?.type === "radio") {
        evt.preventDefault()
        cycleOption(w, -1)
      } else if (w?.type === "slider") {
        evt.preventDefault()
        adjustSlider(w, -1)
      }
      return
    }
    if (evt.name === "right" || evt.name === "l") {
      if (w?.type === "select" || w?.type === "radio") {
        evt.preventDefault()
        cycleOption(w, 1)
      } else if (w?.type === "slider") {
        evt.preventDefault()
        adjustSlider(w, 1)
      }
      return
    }

    if (evt.name === "space") {
      if (w?.type === "checkbox") {
        evt.preventDefault()
        setVal(w.id, !getVal(w.id))
      } else if (isMulti) {
        evt.preventDefault()
        const opt = w.options?.[store.cursor]
        if (opt) toggleMulti(w, opt.value)
      }
      return
    }

    if (evt.name === "return") {
      evt.preventDefault()
      if (!w) return
      if (w.type === "button") dispatch(w.action)
      else if (w.type === "checkbox") setVal(w.id, !getVal(w.id))
      else if (w.type === "text_input" || w.type === "textarea" || w.type === "number_input") {
        setStore("editing", true)
      }
      return
    }
  })

  const accent = () => theme.accent.alt

  function colorOf(c?: InteractionColor) {
    switch (c) {
      case "primary":
        return theme.accent.fg
      case "secondary":
        return theme.accent.secondary
      case "accent":
        return accent()
      case "success":
        return theme.status.success.fg
      case "warning":
        return theme.status.warning.fg
      case "error":
        return theme.status.error.fg
      case "info":
        return theme.status.info.fg ?? theme.accent.fg
      case "muted":
        return theme.foreground.muted
      default:
        return theme.foreground.default
    }
  }

  const Field = (p: { label: string; help?: string; focused: boolean; children: JSX.Element }) => (
    <box paddingLeft={1} flexDirection="column">
      <box flexDirection="row" gap={1}>
        <text fg={p.focused ? accent() : theme.foreground.muted}>{p.focused ? "›" : " "}</text>
        <text fg={p.focused ? theme.foreground.default : theme.foreground.muted}>{p.label}</text>
      </box>
      <box paddingLeft={2}>{p.children}</box>
      <Show when={p.help}>
        <box paddingLeft={2}>
          <text fg={theme.foreground.muted}>{p.help}</text>
        </box>
      </Show>
    </box>
  )

  function Widget(wp: { widget: WidgetLeaf }): JSX.Element {
    const w = wp.widget as any
    const isFocused = createMemo(() => focusMap().get(wp.widget) === store.focus)
    return (
      <Switch>
        <Match when={w.type === "heading"}>
          <box paddingLeft={1}>
            <text fg={accent()} attributes={1}>
              {interpolate(w.text)}
            </text>
          </box>
        </Match>
        <Match when={w.type === "text"}>
          <box paddingLeft={1}>
            <text fg={colorOf(w.color)}>{interpolate(w.content)}</text>
          </box>
        </Match>
        <Match when={w.type === "markdown"}>
          <box paddingLeft={1}>
            <text fg={theme.foreground.default}>{interpolate(w.content)}</text>
          </box>
        </Match>
        <Match when={w.type === "alert"}>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={colorOf(w.severity)}>{alertIcon(w.severity)}</text>
            <box flexDirection="column">
              <Show when={w.title}>
                <text fg={colorOf(w.severity)}>{w.title}</text>
              </Show>
              <text fg={theme.foreground.default}>{interpolate(w.message)}</text>
            </box>
          </box>
        </Match>
        <Match when={w.type === "divider"}>
          <box paddingLeft={1}>
            <text fg={theme.foreground.muted}>{w.label ? `── ${w.label} ──` : "──────────"}</text>
          </box>
        </Match>

        <Match when={w.type === "text_input" || w.type === "textarea" || w.type === "number_input"}>
          <Field label={w.label} help={w.help} focused={isFocused()}>
            <Show
              when={isFocused() && store.editing}
              fallback={
                <text fg={isFocused() ? theme.foreground.default : theme.foreground.muted}>
                  {String(getVal(w.id) ?? "") || (w.placeholder ?? "—")}
                </text>
              }
            >
              <textarea
                ref={(val: TextareaRenderable) => {
                  textarea = val
                  queueMicrotask(() => {
                    val.focus()
                    val.gotoLineEnd()
                  })
                }}
                initialValue={String(getVal(w.id) ?? "")}
                placeholder={w.placeholder ?? ""}
                textColor={theme.foreground.default}
                focusedTextColor={theme.foreground.default}
                cursorColor={theme.accent.fg}
                keyBindings={bindings()}
              />
            </Show>
          </Field>
        </Match>

        <Match when={w.type === "select" || w.type === "radio"}>
          <Field label={w.label} help={w.help} focused={isFocused()}>
            <box flexDirection="column">
              <For each={w.options}>
                {(opt: any) => {
                  const sel = () => getVal(w.id) === opt.value
                  return (
                    <text
                      fg={
                        sel()
                          ? theme.status.success.fg
                          : isFocused()
                            ? theme.foreground.default
                            : theme.foreground.muted
                      }
                    >
                      {sel() ? "◉" : "○"} {opt.label ?? opt.value}
                    </text>
                  )
                }}
              </For>
            </box>
          </Field>
        </Match>

        <Match when={w.type === "multiselect"}>
          <Field label={w.label} help={w.help} focused={isFocused()}>
            <box flexDirection="column">
              <For each={w.options}>
                {(opt: any, i) => {
                  const arr = () => (Array.isArray(getVal(w.id)) ? (getVal(w.id) as string[]) : [])
                  const checked = () => arr().includes(opt.value)
                  const onCursor = () => isFocused() && store.cursor === i()
                  return (
                    <text
                      fg={
                        onCursor()
                          ? accent()
                          : checked()
                            ? theme.status.success.fg
                            : isFocused()
                              ? theme.foreground.default
                              : theme.foreground.muted
                      }
                    >
                      {onCursor() ? "›" : " "} [{checked() ? "✓" : " "}] {opt.label ?? opt.value}
                    </text>
                  )
                }}
              </For>
            </box>
          </Field>
        </Match>

        <Match when={w.type === "checkbox"}>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={isFocused() ? accent() : theme.foreground.muted}>{isFocused() ? "›" : " "}</text>
            <text
              fg={
                getVal(w.id) ? theme.status.success.fg : isFocused() ? theme.foreground.default : theme.foreground.muted
              }
            >
              [{getVal(w.id) ? "✓" : " "}] {w.label}
            </text>
          </box>
        </Match>

        <Match when={w.type === "slider"}>
          <Field label={w.label} help={w.help} focused={isFocused()}>
            <box flexDirection="row" gap={1}>
              <text fg={isFocused() ? theme.foreground.default : theme.foreground.muted}>
                {sliderBar(w, Number(getVal(w.id) ?? w.min ?? 0))}
              </text>
              <text fg={accent()}>
                {String(getVal(w.id) ?? w.min ?? 0)}
                {w.unit ?? ""}
              </text>
            </box>
          </Field>
        </Match>

        <Match when={w.type === "button"}>
          <box paddingLeft={1} flexDirection="row">
            <box
              paddingLeft={2}
              paddingRight={2}
              backgroundColor={isFocused() ? buttonBg(w.variant) : theme.surface.offset}
            >
              <text fg={isFocused() ? theme.badge.fg : buttonFg(w.variant)}>{w.label}</text>
            </box>
          </box>
        </Match>
      </Switch>
    )
  }

  function alertIcon(sev: string): string {
    return sev === "success" ? "✓" : sev === "warning" ? "⚠" : sev === "error" ? "✗" : "ℹ"
  }
  function buttonFg(variant?: string) {
    if (variant === "primary") return theme.accent.fg
    if (variant === "danger") return theme.status.error.fg
    return theme.foreground.default
  }
  function buttonBg(variant?: string) {
    if (variant === "danger") return theme.status.error.fg
    if (variant === "secondary") return theme.surface.offset
    return accent()
  }
  function sliderBar(w: any, value: number): string {
    const min = typeof w.min === "number" ? w.min : 0
    const max = typeof w.max === "number" ? w.max : 100
    const width = 16
    const ratio = max > min ? (value - min) / (max - min) : 0
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)))
    return "─".repeat(filled) + "●" + "─".repeat(Math.max(0, width - filled))
  }

  const Container = (cp: { comp: BodyComponentType }): JSX.Element => {
    const c = cp.comp as any
    return (
      <Switch>
        <Match when={c.type === "row"}>
          <box flexDirection="row" gap={2} paddingLeft={1}>
            <For each={c.children}>{(child: WidgetLeaf) => <Widget widget={child} />}</For>
          </box>
        </Match>
        <Match when={c.type === "group"}>
          <box
            flexDirection="column"
            gap={1}
            paddingLeft={1}
            paddingTop={1}
            paddingBottom={1}
            border={["left"]}
            borderColor={theme.border.default ?? theme.foreground.muted}
          >
            <Show when={c.title}>
              <text fg={theme.foreground.default} attributes={1}>
                {c.title}
              </text>
            </Show>
            <Show when={c.description}>
              <text fg={theme.foreground.muted}>{c.description}</text>
            </Show>
            <For each={c.children}>{(child: BodyComponentType) => <Container comp={child} />}</For>
          </box>
        </Match>
        <Match when={true}>
          <Widget widget={cp.comp as WidgetLeaf} />
        </Match>
      </Switch>
    )
  }

  const contentHeight = createMemo(() => {
    const h = dimensions().height
    return Math.max(10, Math.min(h - 10, Math.floor(h * 0.78)))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="column" gap={0}>
          <text fg={accent()} attributes={TextAttributes.BOLD}>
            ◈ {spec().title}
          </text>
          <Show when={spec().subtitle}>
            <text fg={theme.foreground.muted}>{spec().subtitle}</text>
          </Show>
        </box>
        <Show when={spec().screens.length > 1} fallback={<text fg={theme.foreground.muted}>esc cancel</text>}>
          <text fg={theme.foreground.muted}>
            {currentScreen()?.title ?? store.screen} ({spec().screens.findIndex((s) => s.id === store.screen) + 1}/
            {spec().screens.length}) · esc
          </text>
        </Show>
      </box>

      <box border borderColor={theme.border.default} height={contentHeight()} flexShrink={0}>
        <scrollbox height={contentHeight() - 2} focused={true}>
          <box paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1} gap={1}>
            <For each={currentScreen()?.body ?? []}>{(comp) => <Container comp={comp} />}</For>
          </box>
        </scrollbox>
      </box>

      <box flexDirection="row" gap={2} flexShrink={0} justifyContent="space-between">
        <box flexDirection="row" gap={2}>
          <text fg={theme.foreground.muted}>⇆ focus</text>
          <text fg={theme.foreground.muted}>↑↓/←→ adjust</text>
          <text fg={theme.foreground.muted}>space toggle</text>
          <text fg={theme.foreground.muted}>enter edit/activate</text>
        </box>
        <Show when={focused()}>
          <text fg={tint(theme.foreground.muted, accent(), 0.5)}>{(focused() as any)?.type}</text>
        </Show>
      </box>
    </box>
  )
}
