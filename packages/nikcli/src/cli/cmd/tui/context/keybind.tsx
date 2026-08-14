import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { Keybind } from "@tui/util/keybind"
import { pipe, mapValues } from "remeda"
import type { KeybindsConfig } from "@nikcli-ai/sdk/httpapi"
import type { ParsedKey, Renderable } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSimpleContext } from "./helper"

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const sync = useSync()
    const keybinds = createMemo(() => {
      return pipe(
        sync.data.config.keybinds ?? {},
        mapValues((value) => Keybind.parse(value)),
      )
    })
    const [store, setStore] = createStore({
      leader: false,
    })
    const renderer = useRenderer()

    let focus: Renderable | null
    let timeout: NodeJS.Timeout

    /** Safely blur a renderable, checking isDestroyed first */
    function safeBlur(r: Renderable | null) {
      if (!r || r.isDestroyed) return
      r.blur()
    }

    /** Safely focus a renderable, checking isDestroyed first */
    function safeFocus(r: Renderable | null) {
      if (!r || r.isDestroyed) return
      r.focus()
    }

    function leader(active: boolean) {
      if (active) {
        setStore("leader", true)
        focus = renderer.currentFocusedRenderable
        safeBlur(focus)
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => {
          if (!store.leader) return
          leader(false)
          safeFocus(focus)
        }, 2000)
        return
      }

      if (!active) {
        if (focus && !renderer.currentFocusedRenderable) {
          safeFocus(focus)
        }
        setStore("leader", false)
      }
    }

    useKeyboard(async (evt) => {
      if (!store.leader && result.match("leader", evt)) {
        leader(true)
        return
      }

      if (store.leader && evt.name) {
        setImmediate(() => {
          if (focus && renderer.currentFocusedRenderable === focus) {
            safeFocus(focus)
          }
          leader(false)
        })
      }
    })

    const result = {
      get all() {
        return keybinds()
      },
      get leader() {
        return store.leader
      },
      parse(evt: ParsedKey): Keybind.Info {
        // Handle special case for Ctrl+Underscore (represented as \x1F)
        if (evt.name === "\x1F") {
          return Keybind.fromParsedKey({ ...evt, name: "_", ctrl: true }, store.leader)
        }
        return Keybind.fromParsedKey(evt, store.leader)
      },
      match(key: string, evt: ParsedKey): boolean {
        const list = keybinds()[key as keyof KeybindsConfig] ?? Keybind.parse(key)
        if (!list) return false
        const parsed: Keybind.Info = result.parse(evt)
        for (const k of list) {
          if (Keybind.match(k, parsed)) {
            return true
          }
        }
        return false
      },
      print(key: string) {
        const first = (keybinds()[key as keyof KeybindsConfig] ?? Keybind.parse(key)).at(0)
        if (!first) return ""
        const r = Keybind.toString(first)
        return r.replace("<leader>", Keybind.toString(keybinds().leader![0]!))
      },
    }
    return result
  },
})
