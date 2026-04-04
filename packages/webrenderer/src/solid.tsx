import { extend } from "@opentui/solid"
import { WebViewRenderable } from "./webview-renderable"

extend({ webview: WebViewRenderable })

export { BrowserRuntime, WebViewController, createWebViewController, normalizeWebUrl } from "./runtime"
export type { BrowserSession } from "./runtime"
export { WebViewRenderable } from "./webview-renderable"
