import type { JSX } from "solid-js"

interface ModalProps {
  title: string
  onClose: () => void
  children: JSX.Element
  footer?: JSX.Element
  wide?: boolean
}

export function Modal(props: ModalProps) {
  return (
    <div class="modal-overlay" onClick={props.onClose}>
      <div class={`modal${props.wide ? " modal-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h2>{props.title}</h2>
          <button class="btn btn-ghost" onClick={props.onClose}>Close</button>
        </div>
        <div class="modal-body">{props.children}</div>
        {props.footer && <div class="modal-footer">{props.footer}</div>}
      </div>
    </div>
  )
}
