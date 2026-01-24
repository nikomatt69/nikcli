import { TextAttributes, RGBA } from "@opentui/core"
import { createMemo, For, Show, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { Global } from "@/global"
import path from "path"
import { mkdir } from "fs/promises"

interface ColorDef {
  key: string
  label: string
  description: string
}

const COLOR_DEFS: ColorDef[] = [
  { key: "primary", label: "Primary", description: "Main accent color" },
  { key: "secondary", label: "Secondary", description: "Secondary accent" },
  { key: "accent", label: "Accent", description: "Extra accent" },
  { key: "error", label: "Error", description: "Error color" },
  { key: "warning", label: "Warning", description: "Warning color" },
  { key: "success", label: "Success", description: "Success color" },
  { key: "info", label: "Info", description: "Info color" },
  { key: "text", label: "Text", description: "Main text color" },
  { key: "textMuted", label: "Text Muted", description: "Muted text color" },
  { key: "background", label: "Background", description: "Main background" },
  { key: "backgroundPanel", label: "Panel", description: "Panel background" },
  { key: "backgroundElement", label: "Element", description: "Element background" },
  { key: "border", label: "Border", description: "Border color" },
  { key: "borderActive", label: "Border Active", description: "Active border" },
  { key: "borderSubtle", label: "Border Subtle", description: "Subtle border" },
]

const PRESET_COLORS = [
  "#6fa3ff", "#a78bfa", "#f472b6", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#06b6d4", "#14b8a6", "#6366f1",
  "#d45f5f", "#d9a14a", "#7fc08f", "#58a6b8", "#d2b56d",
  "#070707", "#121212", "#1b1b1b", "#242424", "#2e2e2e",
  "#3a3a3a", "#4a4a4a", "#5c5c5c", "#8bb4ff", "#9a9a9a",
  "#e6e6e6", "#f7f7f7", "#ededed", "#e2e2e2",
]

function rgbaToHex(rgba: RGBA): string {
  const r = Math.round(rgba.r * 255)
  const g = Math.round(rgba.g * 255)
  const b = Math.round(rgba.b * 255)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

function generateGrayScale(bg: RGBA, isDark: boolean): Record<number, RGBA> {
  const grays: Record<number, RGBA> = {}
  const bgR = bg.r * 255
  const bgG = bg.g * 255
  const bgB = bg.b * 255
  const luminance = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  for (let i = 1; i <= 12; i++) {
    const factor = i / 12.0
    let newR: number, newG: number, newB: number

    if (isDark) {
      if (luminance < 10) {
        const grayValue = Math.floor(factor * 0.4 * 255)
        newR = grayValue
        newG = grayValue
        newB = grayValue
      } else {
        const newLum = luminance + (255 - luminance) * factor * 0.4
        const ratio = newLum / luminance
        newR = Math.min(bgR * ratio, 255)
        newG = Math.min(bgG * ratio, 255)
        newB = Math.min(bgB * ratio, 255)
      }
    } else {
      if (luminance > 245) {
        const grayValue = Math.floor(255 - factor * 0.4 * 255)
        newR = grayValue
        newG = grayValue
        newB = grayValue
      } else {
        const newLum = luminance * (1 - factor * 0.4)
        const ratio = newLum / luminance
        newR = Math.max(bgR * ratio, 0)
        newG = Math.max(bgG * ratio, 0)
        newB = Math.max(bgB * ratio, 0)
      }
    }
    grays[i] = RGBA.fromInts(Math.floor(newR), Math.floor(newG), Math.floor(newB))
  }
  return grays
}

function generateMutedTextColor(bg: RGBA, isDark: boolean): RGBA {
  const bgR = bg.r * 255
  const bgG = bg.g * 255
  const bgB = bg.b * 255
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB

  let grayValue: number
  if (isDark) {
    grayValue = bgLum < 10 ? 180 : Math.min(Math.floor(160 + bgLum * 0.3), 200)
  } else {
    grayValue = bgLum > 245 ? 75 : Math.max(Math.floor(100 - (255 - bgLum) * 0.2), 60)
  }
  return RGBA.fromInts(grayValue, grayValue, grayValue)
}

export function DialogThemeCreate() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()

  const [store, setStore] = createStore({
    name: "",
    base: "dark" as "dark" | "light",
    colors: {} as Record<string, string>,
    selectedColor: "primary" as string | null,
    saving: false,
    selectedIndex: 0,
    pickerIndex: 0,
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const grays = createMemo(() => {
    const bgHex = store.base === "dark" ? "#070707" : "#f7f7f7"
    return generateGrayScale(RGBA.fromHex(bgHex), store.base === "dark")
  })

  const textMuted = createMemo(() => {
    const bgHex = store.base === "dark" ? "#070707" : "#f7f7f7"
    return generateMutedTextColor(RGBA.fromHex(bgHex), store.base === "dark")
  })

  const selectedColorDef = createMemo(() =>
    COLOR_DEFS.find(c => c.key === store.selectedColor)
  )

  const colorsPerRow = createMemo(() => {
    const width = dimensions().width
    if (width >= 100) return 5
    if (width >= 80) return 4
    return 3
  })

  const generatedTheme = createMemo(() => {
    const mode = store.base
    const prefix = store.base === "dark" ? "darkStep" : "lightStep"

    return {
      $schema: "https://nikcli.ai/theme.json",
      defs: {
        [`${prefix}1`]: store.base === "dark" ? "#070707" : "#f7f7f7",
        [`${prefix}2`]: rgbaToHex(grays()[2]!),
        [`${prefix}3`]: rgbaToHex(grays()[3]!),
        [`${prefix}4`]: rgbaToHex(grays()[4]!),
        [`${prefix}5`]: rgbaToHex(grays()[5]!),
        [`${prefix}6`]: rgbaToHex(grays()[6]!),
        [`${prefix}7`]: rgbaToHex(grays()[7]!),
        [`${prefix}8`]: rgbaToHex(grays()[8]!),
        [`${prefix}9`]: store.colors.primary || "#6fa3ff",
        [`${prefix}10`]: rgbaToHex(grays()[10]!),
        [`${prefix}11`]: rgbaToHex(textMuted()),
        [`${prefix}12`]: rgbaToHex(grays()[12]!),
      },
      theme: {
        primary: { [mode]: store.colors.primary || `${prefix}9` },
        secondary: { [mode]: store.colors.secondary || `${prefix}9` },
        accent: { [mode]: store.colors.accent || `${prefix}9` },
        error: { [mode]: store.colors.error || "#d45f5f" },
        warning: { [mode]: store.colors.warning || "#d9a14a" },
        success: { [mode]: store.colors.success || "#7fc08f" },
        info: { [mode]: store.colors.info || "#58a6b8" },
        text: { [mode]: store.colors.text || `${prefix}12` },
        textMuted: { [mode]: store.colors.textMuted || `${prefix}11` },
        background: { [mode]: store.colors.background || `${prefix}1` },
        backgroundPanel: { [mode]: store.colors.backgroundPanel || `${prefix}2` },
        backgroundElement: { [mode]: store.colors.backgroundElement || `${prefix}3` },
        border: { [mode]: store.colors.border || `${prefix}7` },
        borderActive: { [mode]: store.colors.borderActive || `${prefix}8` },
        borderSubtle: { [mode]: store.colors.borderSubtle || `${prefix}6` },
        diffAdded: { [mode]: "#4fd6be" },
        diffRemoved: { [mode]: "#c53b53" },
        diffContext: { [mode]: "#828bb8" },
        diffHunkHeader: { [mode]: "#828bb8" },
        diffHighlightAdded: { [mode]: "#b8db87" },
        diffHighlightRemoved: { [mode]: "#e26a75" },
        diffAddedBg: { [mode]: "#20303b" },
        diffRemovedBg: { [mode]: "#37222c" },
        diffContextBg: { [mode]: `${prefix}2` },
        diffLineNumber: { [mode]: `${prefix}3` },
        diffAddedLineNumberBg: { [mode]: "#1b2b34" },
        diffRemovedLineNumberBg: { [mode]: "#2d1f26" },
        markdownText: { [mode]: `${prefix}12` },
        markdownHeading: { [mode]: store.colors.accent || `${prefix}9` },
        markdownLink: { [mode]: `${prefix}9` },
        markdownLinkText: { [mode]: "#58a6b8" },
        markdownCode: { [mode]: "#7fc08f" },
        markdownBlockQuote: { [mode]: "#d2b56d" },
        markdownEmph: { [mode]: "#d2b56d" },
        markdownStrong: { [mode]: "#d9a14a" },
        markdownHorizontalRule: { [mode]: `${prefix}11` },
        markdownListItem: { [mode]: `${prefix}9` },
        markdownListEnumeration: { [mode]: "#58a6b8" },
        markdownImage: { [mode]: `${prefix}9` },
        markdownImageText: { [mode]: "#58a6b8" },
        markdownCodeBlock: { [mode]: `${prefix}12` },
        syntaxComment: { [mode]: `${prefix}11` },
        syntaxKeyword: { [mode]: store.colors.accent || `${prefix}9` },
        syntaxFunction: { [mode]: `${prefix}9` },
        syntaxVariable: { [mode]: "#d45f5f" },
        syntaxString: { [mode]: "#7fc08f" },
        syntaxNumber: { [mode]: "#d9a14a" },
        syntaxType: { [mode]: "#d2b56d" },
        syntaxOperator: { [mode]: "#58a6b8" },
        syntaxPunctuation: { [mode]: `${prefix}12` },
      },
    }
  })

  const handleSave = async () => {
    if (!store.name.trim()) return
    setStore("saving", true)
    try {
      const configDir = Global.Path.config
      const themesDir = path.join(configDir, "themes")
      await mkdir(themesDir, { recursive: true })
      const filePath = path.join(themesDir, `${store.name}.json`)
      await Bun.write(filePath, JSON.stringify(generatedTheme(), null, 2))
      dialog.clear()
    } catch {
      setStore("saving", false)
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "return" && store.name && !store.saving) {
      handleSave()
      return
    }
    if (evt.name === "escape") {
      dialog.clear()
      return
    }

    const perRow = colorsPerRow()
    const totalColors = COLOR_DEFS.length

    if (evt.name === "down" || evt.name === "j") {
      const newIndex = Math.min(store.selectedIndex + perRow, totalColors - 1)
      setStore("selectedIndex", newIndex)
      setStore("selectedColor", COLOR_DEFS[newIndex].key)
      return
    }
    if (evt.name === "up" || evt.name === "k") {
      const newIndex = Math.max(store.selectedIndex - perRow, 0)
      setStore("selectedIndex", newIndex)
      setStore("selectedColor", COLOR_DEFS[newIndex].key)
      return
    }
    if (evt.name === "left" || evt.name === "h") {
      const newIndex = Math.max(store.selectedIndex - 1, 0)
      setStore("selectedIndex", newIndex)
      setStore("selectedColor", COLOR_DEFS[newIndex].key)
      return
    }
    if (evt.name === "right" || evt.name === "l") {
      const newIndex = Math.min(store.selectedIndex + 1, totalColors - 1)
      setStore("selectedIndex", newIndex)
      setStore("selectedColor", COLOR_DEFS[newIndex].key)
      return
    }

    // Color picker navigation
    if (store.selectedColor && store.selectedColor !== "__name__") {
      const pickerTotal = PRESET_COLORS.length
      if (evt.name === "w" || evt.name === "W") {
        const newPickerIndex = Math.max(store.pickerIndex - 5, 0)
        setStore("pickerIndex", newPickerIndex)
        return
      }
      if (evt.name === "s" || evt.name === "S") {
        const newPickerIndex = Math.min(store.pickerIndex + 5, pickerTotal - 1)
        setStore("pickerIndex", newPickerIndex)
        return
      }
      if (evt.name === "a" || evt.name === "A" || evt.name === "p") {
        const newPickerIndex = Math.max(store.pickerIndex - 1, 0)
        setStore("pickerIndex", newPickerIndex)
        return
      }
      if (evt.name === "d" || evt.name === "D" || evt.name === "n") {
        const newPickerIndex = Math.min(store.pickerIndex + 1, pickerTotal - 1)
        setStore("pickerIndex", newPickerIndex)
        return
      }
      if (evt.name === "space" || evt.name === " ") {
        const color = PRESET_COLORS[store.pickerIndex]
        if (color && store.selectedColor) {
          setStore("colors", store.selectedColor, color)
        }
        return
      }
    }
  })

  const colorBoxWidth = createMemo(() => {
    const width = dimensions().width
    const padding = 4
    const gap = 1
    const perRow = colorsPerRow()
    return Math.floor((width - padding - gap * (perRow - 1)) / perRow)
  })

  const colorList = COLOR_DEFS.map((def, index) => ({
    ...def,
    index,
    value: store.colors[def.key] || (def.key === "primary" ? "#6fa3ff" : def.key === "background" ? "#070707" : "#6fa3ff"),
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>Create Theme</text>
        <text fg={theme.textMuted}>hjkl/arrows to navigate, space to pick</text>
      </box>

      {/* Theme Name Input */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.textMuted}>Name:</text>
        <box
          width={25}
          border={["bottom"]}
          borderColor={store.selectedColor === "__name__" ? theme.primary : theme.borderSubtle}
          onMouseUp={() => {
            setStore("selectedColor", "__name__")
            setStore("selectedIndex", -1)
          }}
        >
          <input
            value={store.name}
            onInput={(v) => setStore("name", v)}
            placeholder="my-theme"
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
          />
        </box>
      </box>

      {/* Base Toggle */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.textMuted}>Base:</text>
        <For each={["dark", "light"] as const}>
          {(base) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={store.base === base ? theme.primary : theme.backgroundElement}
              onMouseUp={() => setStore("base", base)}
            >
              <text
                fg={store.base === base ? theme.selectedListItemText : theme.text}
              >{base}</text>
            </box>
          )}
        </For>
      </box>

      <box height={1} border={["top"]} borderColor={theme.borderSubtle} />

      {/* Color Grid */}
      <scrollbox maxHeight={18} scrollbarOptions={{ visible: false }}>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={colorList}>
            {(item) => {
              const colorValue = store.colors[item.key] ||
                (item.key === "primary" ? "#6fa3ff" : item.key === "background" ? "#070707" : "#6fa3ff")
              const isSelected = store.selectedIndex === item.index
              return (
                <box
                  width={colorBoxWidth()}
                  backgroundColor={theme.backgroundPanel}
                  border={["top", "bottom", "left", "right"]}
                  borderColor={isSelected ? theme.primary : theme.borderSubtle}
                  onMouseUp={() => {
                    setStore("selectedIndex", item.index)
                    setStore("selectedColor", item.key)
                  }}
                >
                  <box paddingLeft={1} gap={0}>
                    <text
                      fg={isSelected ? theme.primary : theme.text}
                      attributes={isSelected ? TextAttributes.BOLD : undefined}
                    >{item.label}</text>
                    <box flexDirection="row" gap={0} alignItems="center" paddingTop={1}>
                      <box
                        width={3}
                        height={1}
                        backgroundColor={RGBA.fromHex(colorValue)}
                      />
                      <text fg={theme.textMuted} marginLeft={1}>
                        {colorValue}
                      </text>
                    </box>
                  </box>
                </box>
              )
            }}
          </For>
        </box>
      </scrollbox>

      {/* Color Picker */}
      <Show when={store.selectedColor && store.selectedColor !== "__name__"}>
        <box
          backgroundColor={theme.backgroundPanel}
          border={["top", "bottom", "left", "right"]}
          borderColor={theme.border}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          gap={1}
        >
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              {selectedColorDef()?.label}: {selectedColorDef()?.description}
            </text>
          </box>
          <scrollbox maxHeight={5} scrollbarOptions={{ visible: false }}>
            <box flexDirection="row" flexWrap="wrap" gap={1}>
              <For each={PRESET_COLORS}>
                {(color, i) => {
                  const isSelected = i() === store.pickerIndex
                  return (
                    <box
                      width={4}
                      height={1}
                      backgroundColor={RGBA.fromHex(color)}
                      border={["top", "bottom", "left", "right"]}
                      borderColor={isSelected ? theme.primary : theme.borderSubtle}
                      onMouseUp={() => {
                        setStore("pickerIndex", i())
                        if (store.selectedColor) {
                          setStore("colors", store.selectedColor, color)
                        }
                      }}
                    />
                  )
                }}
              </For>
            </box>
          </scrollbox>
        </box>
      </Show>

      <box height={1} border={["top"]} borderColor={theme.borderSubtle} />

      {/* Preview & Save */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <box flexDirection="row" gap={1}>
          <Show when={store.colors.primary}>
            <box
              width={4}
              height={2}
              backgroundColor={RGBA.fromHex(store.colors.primary || "#6fa3ff")}
              border={["top", "bottom", "left", "right"]}
              borderColor={theme.borderSubtle}
            >
              <box paddingLeft={1} paddingTop={1}>
                <text fg={RGBA.fromHex(store.colors.background || "#070707")}>Aa</text>
              </box>
            </box>
          </Show>
          <Show when={store.colors.background}>
            <box
              width={4}
              height={2}
              backgroundColor={RGBA.fromHex(store.colors.background || "#070707")}
              border={["top", "bottom", "left", "right"]}
              borderColor={theme.borderSubtle}
              justifyContent="center"
              alignItems="center"
            >
              <text fg={RGBA.fromHex(store.colors.text || "#e6e6e6")}>Text</text>
            </box>
          </Show>
        </box>

        <box flexDirection="row" gap={1}>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.backgroundElement}
            onMouseUp={() => dialog.clear()}
          >
            <text fg={theme.textMuted}>Cancel</text>
          </box>
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={store.name && !store.saving ? theme.primary : theme.backgroundElement}
            onMouseUp={() => store.name && !store.saving && handleSave()}
          >
            <text
              fg={store.name && !store.saving ? theme.selectedListItemText : theme.textMuted}
            >{store.saving ? "Saving..." : "Save Theme"}</text>
          </box>
        </box>
      </box>
    </box>
  )
}
