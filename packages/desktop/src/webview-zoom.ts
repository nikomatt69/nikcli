// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { invoke } from "@tauri-apps/api/core"
import { type as ostype } from "@tauri-apps/plugin-os"
import { createSignal } from "solid-js"

const TAURI_AVAILABLE = typeof window === "object" && "__TAURI_INTERNALS__" in window
const OS_NAME = TAURI_AVAILABLE
  ? ostype()
  : typeof navigator === "object" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "macos"
    : "linux"

const [webviewZoom, setWebviewZoom] = createSignal(1)

const MAX_ZOOM_LEVEL = 10
const MIN_ZOOM_LEVEL = 0.2

const clamp = (value: number) => Math.min(Math.max(value, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)

const applyZoom = (next: number) => {
  setWebviewZoom(next)
  if (TAURI_AVAILABLE) {
    void invoke("plugin:webview|set_webview_zoom", { value: next })
    return
  }
  document.documentElement.style.zoom = String(next)
}

window.addEventListener("keydown", (event) => {
  if (!(OS_NAME === "macos" ? event.metaKey : event.ctrlKey)) return

  let newZoom = webviewZoom()

  if (event.key === "-") newZoom -= 0.2
  if (event.key === "=" || event.key === "+") newZoom += 0.2
  if (event.key === "0") newZoom = 1

  applyZoom(clamp(newZoom))
})

export { webviewZoom }
