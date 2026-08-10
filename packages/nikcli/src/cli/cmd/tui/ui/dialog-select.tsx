import { InputRenderable, RGBA, ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { entries, flatMap, groupBy, pipe } from "remeda"
import { batch, createEffect, createMemo, For, onCleanup, Show, type JSX, on } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { isDeepEqual } from "remeda"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import { Keybind } from "@/util/keybind"
import { Locale } from "@/util/locale"
import { moveSelection, reconcileSelection } from "./select-controller"

export interface DialogSelectProps<T> {
  title: string
  placeholder?: string
  options: DialogSelectOption<T>[]
  ref?: (ref: DialogSelectRef<T>) => void
  onMove?: (option: DialogSelectOption<T>) => void
  onFilter?: (query: string) => void
  onSelect?: (option: DialogSelectOption<T>) => void
  skipFilter?: boolean
  getOptionKey?: (option: DialogSelectOption<T>, index: number) => string
  keybind?: DialogSelectKeybind<T>[]
  current?: T
}

/**
 * `allowEmpty` keybinds fire even with nothing selected, which is what actions
 * that change *which* options exist (a scope switch, a reload) need: without it
 * an empty result list is a dead end you cannot toggle out of.
 */
export type DialogSelectKeybind<T> =
  | {
      keybind?: Keybind.Info
      title: string
      disabled?: boolean
      allowEmpty?: false
      onTrigger: (option: DialogSelectOption<T>) => void
    }
  | {
      keybind?: Keybind.Info
      title: string
      disabled?: boolean
      allowEmpty: true
      onTrigger: (option: DialogSelectOption<T> | undefined) => void
    }

export interface DialogSelectOption<T = unknown> {
  title: string
  value: T
  description?: string
  searchText?: string
  footer?: JSX.Element | string
  category?: string
  disabled?: boolean
  bg?: RGBA
  gutter?: JSX.Element
  onSelect?: (ctx: DialogContext) => void
}

export type DialogSelectRef<T> = {
  filter: string
  filtered: DialogSelectOption<T>[]
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: 0,
    filter: "",
    input: "keyboard" as "keyboard" | "mouse",
  })

  createEffect(
    on(
      () => props.current,
      (current) => {
        if (current) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            setStore("selected", currentIndex)
          }
        }
      },
    ),
  )

  let input: InputRenderable

  const filtered = createMemo(() => {
    if (props.skipFilter) {
      return props.options.filter((x) => x.disabled !== true)
    }
    const needle = store.filter.toLowerCase()
    // Preprocess options for case-insensitive fuzzysort
    const normalizedOptions = props.options
      .filter((x) => x.disabled !== true)
      .map((opt) => ({
        ...opt,
        _normalizedTitle: opt.title.toLowerCase(),
        _normalizedCategory: (opt.category ?? "").toLowerCase(),
        _normalizedSearchText: (opt.searchText ?? "").toLowerCase(),
      }))
    const result = !needle
      ? normalizedOptions
      : fuzzysort
          .go(needle, normalizedOptions, {
            keys: ["_normalizedTitle", "_normalizedCategory", "_normalizedSearchText"],
            scoreFn: (result) => result[0].score * 2 + result[1].score + result[2].score,
          })
          .map((x) => x.obj)
    return result
  })

  // When the filter changes due to how TUI works, the mousemove might still be triggered
  // via a synthetic event as the layout moves underneath the cursor. This is a workaround to make sure the input mode remains keyboard
  // that the mouseover event doesn't trigger when filtering.
  createEffect(
    on(
      () => filtered(),
      () => {
        setStore("input", "keyboard")
      },
      { defer: true },
    ),
  )

  const grouped = createMemo(() => {
    const result = pipe(
      filtered(),
      groupBy((x) => x.category ?? ""),
      // mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
      entries(),
    )
    const seen = new Set<string>()
    return result.filter(([category]) => {
      if (seen.has(category)) return false
      seen.add(category)
      return true
    })
  })

  const flat = createMemo(() => {
    return pipe(
      grouped(),
      flatMap(([_, options]) => options),
    )
  })

  const dimensions = useTerminalDimensions()
  const height = createMemo(() =>
    Math.max(1, Math.min(flat().length + grouped().length * 2 - 1, Math.floor(dimensions().height / 2) - 6)),
  )

  const selected = createMemo(() => flat()[store.selected])
  // Memoized reference to selected value for cheap reference equality checks
  const selectedValue = createMemo(() => selected()?.value)

  const optionIDs = createMemo(() =>
    flat().map((option, index) => {
      const key = props.getOptionKey?.(option, index)
      return key ? `dialog-select-option-${index}-${key}` : `dialog-select-option-${index}`
    }),
  )

  function optionIndex(option: DialogSelectOption<T>) {
    return flat().indexOf(option)
  }

  function optionID(index: number) {
    return optionIDs()[index] ?? `dialog-select-option-${index}`
  }

  function clampIndex(index: number) {
    return reconcileSelection(index, flat().length)
  }

  createEffect(
    on([() => store.filter, () => props.current], ([filter, current]) => {
      const timer = setTimeout(() => {
        if (filter.length > 0) {
          moveTo(0, true)
        } else if (current) {
          const currentIndex = flat().findIndex((opt) => isDeepEqual(opt.value, current))
          if (currentIndex >= 0) {
            moveTo(currentIndex, true)
          }
        }
      }, 0)
      onCleanup(() => clearTimeout(timer))
    }),
  )

  function move(direction: number, wrap = true) {
    const count = flat().length
    if (count === 0) return
    moveTo(moveSelection(store.selected, { count, delta: direction, policy: wrap ? "wrap" : "clamp" }))
  }

  function moveTo(next: number, center = false) {
    if (flat().length === 0) {
      setStore("selected", 0)
      return
    }
    const index = clampIndex(next)
    const option = flat()[index]
    if (!option) return
    setStore("selected", index)
    props.onMove?.(option)
    if (!scroll) return
    const target = scroll.getChildren().find((child) => {
      return child.id === optionID(index)
    })
    if (!target) return
    const y = target.y - scroll.y
    if (center) {
      const centerOffset = Math.floor(scroll.height / 2)
      scroll.scrollBy(y - centerOffset)
    } else {
      if (y >= scroll.height) {
        scroll.scrollBy(y - scroll.height + 1)
      }
      if (y < 0) {
        scroll.scrollBy(y)
        if (isDeepEqual(flat()[0].value, selected()?.value)) {
          scroll.scrollTo(0)
        }
      }
    }
  }

  const keybind = useKeybind()
  useKeyboard((evt) => {
    setStore("input", "keyboard")

    const handledNavigation =
      evt.name === "up" ||
      evt.name === "down" ||
      evt.name === "pageup" ||
      evt.name === "pagedown" ||
      evt.name === "home" ||
      evt.name === "end" ||
      (evt.ctrl && (evt.name === "p" || evt.name === "n"))

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) move(-1)
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) move(1)
    if (evt.name === "pageup") move(-10, false)
    if (evt.name === "pagedown") move(10, false)
    if (evt.name === "home") moveTo(0)
    if (evt.name === "end") moveTo(flat().length - 1)

    if (handledNavigation) {
      evt.preventDefault()
      evt.stopPropagation()
    }

    if (evt.name === "return") {
      const option = selected()
      if (option) {
        evt.preventDefault()
        evt.stopPropagation()
        if (option.onSelect) option.onSelect(dialog)
        props.onSelect?.(option)
      }
    }

    const keybinds = props.keybind ?? []
    for (const item of keybinds) {
      if (item.disabled || !item.keybind) continue
      if (Keybind.match(item.keybind, keybind.parse(evt))) {
        const s = selected()
        if (!s && !item.allowEmpty) continue
        evt.preventDefault()
        evt.stopPropagation()
        item.onTrigger(s as DialogSelectOption<T>)
      }
    }
  })

  let scroll: ScrollBoxRenderable | undefined
  const ref: DialogSelectRef<T> = {
    get filter() {
      return store.filter
    },
    get filtered() {
      return filtered()
    },
  }
  props.ref?.(ref)

  const keybinds = createMemo(() => props.keybind?.filter((x) => !x.disabled && x.keybind) ?? [])
  let inputFocusTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (inputFocusTimer) clearTimeout(inputFocusTimer)
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <box paddingTop={1} paddingBottom={1}>
          <input
            onInput={(e) => {
              batch(() => {
                setStore("filter", e)
                props.onFilter?.(e)
              })
            }}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r) => {
              input = r
              if (inputFocusTimer) clearTimeout(inputFocusTimer)
              inputFocusTimer = setTimeout(() => {
                if (!input.isDestroyed) input.focus()
              }, 1)
            }}
            placeholder={props.placeholder ?? "Search"}
          />
        </box>
      </box>
      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>No results matching "{store.filter}"</text>
          </box>
        }
      >
        <scrollbox
          paddingLeft={1}
          paddingRight={1}
          scrollbarOptions={{ visible: false }}
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          maxHeight={height()}
        >
          <For each={grouped()}>
            {([category, options], groupIndex) => (
              <>
                <Show when={category}>
                  <box paddingTop={groupIndex() > 0 ? 1 : 0} paddingLeft={3}>
                    <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                      {category}
                    </text>
                  </box>
                </Show>
                <For each={options}>
                  {(option) => {
                    const active = createMemo(() => {
                      const sel = selectedValue()
                      if (sel === option.value) return true
                      return isDeepEqual(sel, option.value)
                    })
                    const current = createMemo(() => {
                      const cur = props.current
                      if (cur === option.value) return true
                      return isDeepEqual(cur, option.value)
                    })
                    return (
                      <box
                        id={optionID(optionIndex(option))}
                        flexDirection="row"
                        onMouseMove={() => setStore("input", "mouse")}
                        onMouseUp={() => {
                          option.onSelect?.(dialog)
                          props.onSelect?.(option)
                        }}
                        onMouseOver={() => {
                          if (store.input !== "mouse") return
                          const idx = optionIndex(option)
                          if (idx === -1) return
                          moveTo(idx)
                        }}
                        onMouseDown={() => {
                          const idx = optionIndex(option)
                          if (idx === -1) return
                          moveTo(idx)
                        }}
                        backgroundColor={active() ? (option.bg ?? theme.primary) : RGBA.fromInts(0, 0, 0, 0)}
                        paddingLeft={current() || option.gutter ? 1 : 3}
                        paddingRight={3}
                        gap={1}
                      >
                        <Option
                          title={option.title}
                          footer={option.footer}
                          description={option.description !== category ? option.description : undefined}
                          active={active()}
                          current={current()}
                          gutter={option.gutter}
                        />
                      </box>
                    )
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
      <Show
        when={keybinds().length}
        fallback={
          <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={1} flexShrink={0} paddingTop={1}>
            <text fg={theme.textMuted}>↑↓ navigate</text>
            <text fg={theme.borderSubtle}>·</text>
            <text fg={theme.textMuted}>↵ select</text>
            <text fg={theme.borderSubtle}>·</text>
            <text fg={theme.textMuted}>esc close</text>
          </box>
        }
      >
        <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
          <For each={keybinds()}>
            {(item) => (
              <box
                onMouseUp={() => {
                  const option = flat().at(store.selected)
                  if (option && item.onTrigger) {
                    item.onTrigger(option)
                  }
                }}
              >
                <text>
                  <span style={{ fg: theme.text }}>
                    <b>{item.title}</b>{" "}
                  </span>
                  <span style={{ fg: theme.accent }}>{Keybind.toString(item.keybind)}</span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function Option(props: {
  title: string
  description?: string
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  gutter?: JSX.Element
  onMouseOver?: () => void
}) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)

  return (
    <>
      <Show when={props.current}>
        <text flexShrink={0} fg={props.active ? fg : props.current ? theme.primary : theme.text} marginRight={0}>
          ●
        </text>
      </Show>
      <Show when={!props.current && props.gutter}>
        <box flexShrink={0} marginRight={0}>
          {props.gutter}
        </box>
      </Show>
      <text
        flexGrow={1}
        fg={props.active ? fg : props.current ? theme.primary : theme.text}
        attributes={props.active ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
        paddingLeft={3}
      >
        {Locale.truncate(props.title, 61)}
        <Show when={props.description}>
          <span style={{ fg: props.active ? fg : theme.textMuted }}> {props.description}</span>
        </Show>
      </text>
      <Show when={props.footer}>
        <box flexShrink={0}>
          <text fg={props.active ? fg : theme.textMuted}>{props.footer}</text>
        </box>
      </Show>
    </>
  )
}
