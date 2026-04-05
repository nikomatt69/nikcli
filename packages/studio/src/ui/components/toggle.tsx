export function Toggle(props: { checked: boolean; onChange: () => void }) {
  return (
    <button
      class={`toggle${props.checked ? " toggle-on" : ""}`}
      onClick={props.onChange}
      type="button"
      aria-checked={props.checked}
      role="switch"
    >
      <span class="toggle-knob" />
    </button>
  )
}
