import { ErrorBoundary, onMount, type JSX } from "solid-js"
import { useToast } from "../ui/toast"
import { errorMessage } from "@/util/error"

/**
 * Contains render-time plugin crashes: a throwing plugin route must not take
 * the TUI down to the stack-trace screen. The crash surfaces as one error toast
 * and the route renders nothing, leaving the rest of the app usable.
 *
 * Plugin slots get the same containment from the slot registry's own per-plugin
 * boundary (see `plugin/slots.tsx`).
 */
export function PluginRouteBoundary(props: { id: string; children?: JSX.Element }) {
  const toast = useToast()
  return (
    <ErrorBoundary
      fallback={(error) => {
        // One toast per crash: onMount is untracked, so prop updates while the
        // boundary is latched cannot re-toast.
        onMount(() =>
          toast.show({
            variant: "error",
            title: "Plugin",
            message: `${props.id} crashed in route: ${errorMessage(error)}`,
          }),
        )
        return null
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}
