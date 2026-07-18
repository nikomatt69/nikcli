import { createSignal, Match, Switch } from "solid-js"
import { useDialog } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"

export interface ArtifactPreviewProps {
  title: string
  description?: string
  kind: "html" | "markdown" | "image" | "video" | "text"
  version: number
  /** Iframe-able page for html/markdown/text; ignored for image/video. */
  viewerUrl: string
  /** Raw content URL — used directly for image/video. */
  previewUrl: string
  /** Owner-gated page (no capability key) — used for "open in new tab" so the link keeps working after the key rotates. */
  url: string
}

export function ArtifactPreview(props: ArtifactPreviewProps) {
  const i18n = useI18n()
  const dialog = useDialog()
  const [copied, setCopied] = createSignal(false)

  const copyLink = async () => {
    await navigator.clipboard.writeText(props.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div data-component="artifact-preview">
      <div data-slot="artifact-preview-container">
        <div data-slot="artifact-preview-content">
          <div data-slot="artifact-preview-header">
            <div data-slot="artifact-preview-heading">
              <span data-slot="artifact-preview-title">{props.title}</span>
              <span data-slot="artifact-preview-meta">
                {props.kind} · v{props.version}
              </span>
            </div>
            <div data-slot="artifact-preview-actions">
              <IconButton
                icon={copied() ? "check" : "copy"}
                variant="ghost"
                aria-label={i18n.t("ui.artifactPreview.copyLink")}
                onClick={() => void copyLink()}
              />
              <IconButton
                icon="square-arrow-top-right"
                variant="ghost"
                aria-label={i18n.t("ui.artifactPreview.openInBrowser")}
                onClick={() => window.open(props.url, "_blank", "noopener,noreferrer")}
              />
              <IconButton
                icon="close"
                variant="ghost"
                aria-label={i18n.t("ui.common.close")}
                onClick={() => dialog.close()}
              />
            </div>
          </div>
          <div data-slot="artifact-preview-body">
            <Switch>
              <Match when={props.kind === "image"}>
                <img data-slot="artifact-preview-image" src={props.previewUrl} alt={props.title} />
              </Match>
              <Match when={props.kind === "video"}>
                <video data-slot="artifact-preview-video" src={props.previewUrl} controls autoplay />
              </Match>
              <Match when={props.kind === "html" || props.kind === "markdown" || props.kind === "text"}>
                <iframe
                  data-slot="artifact-preview-frame"
                  src={props.viewerUrl}
                  title={props.title}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </div>
  )
}
