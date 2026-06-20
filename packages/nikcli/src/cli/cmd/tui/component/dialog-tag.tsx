import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { createStore } from "solid-js/store"
import { createLatestOnlyAsync } from "../util/signal"

export function DialogTag(props: { onSelect?: (value: string) => void }) {
  const sdk = useSDK()
  const dialog = useDialog()

  const [store] = createStore({
    filter: "",
  })

  // Latest-only/abort so a re-query cancels the prior in-flight file search.
  // See specs/opencode-parity/03-request-throttling.md.
  const findFilesLatest = createLatestOnlyAsync<[string], Awaited<ReturnType<typeof sdk.client.find.files>>>(
    ({ input: [query], signal }) => sdk.client.find.files({ query }, { signal }),
  )

  const [files] = createResource(
    () => [store.filter],
    async () => {
      const result = await findFilesLatest(store.filter)
      if (!result || !result.data) return []
      const sliced = result.data.slice(0, 5)
      return sliced
    },
  )

  const options = createMemo(() =>
    (files() ?? []).map((file) => ({
      value: file,
      title: file,
    })),
  )

  return (
    <DialogSelect
      title="Autocomplete"
      options={options()}
      onSelect={(option) => {
        props.onSelect?.(option.value)
        dialog.clear()
      }}
    />
  )
}
