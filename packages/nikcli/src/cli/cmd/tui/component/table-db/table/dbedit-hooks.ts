import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { DBEditRequest } from "../db/types"

export type DBEditStage = "preview" | "edit" | "reject"

export interface UseDBEditOptions {
  request: DBEditRequest
  onAccept: (modified?: DBEditRequest) => void
  onReject: (message?: string) => void
  onModify: (modified: DBEditRequest) => void
}

export function useDBEdit(options: UseDBEditOptions) {
  const [state, setState] = createStore<{
    current: DBEditStage
    modifiedRequest: DBEditRequest | null
    rejectMessage: string
  }>({
    current: "preview",
    modifiedRequest: null,
    rejectMessage: "",
  })

  const request = createMemo(() => options.request)

  const preview = createMemo(() => request().preview)

  const changes = createMemo(() => request().changes)

  const schema = createMemo(() => request().schema)

  const sql = createMemo(() => request().sql ?? "")

  const canEdit = createMemo(() => request().type === "db_create")

  const accept = () => {
    options.onAccept(state.modifiedRequest ?? undefined)
  }

  const reject = (message?: string) => {
    setState({ current: "reject" })
    if (message) {
      setState({ rejectMessage: message })
      options.onReject(message)
    } else {
      options.onReject()
    }
  }

  const modify = (modified: DBEditRequest) => {
    setState({ modifiedRequest: modified, current: "edit" })
    options.onModify(modified)
  }

  const backToPreview = () => {
    setState({ current: "preview" })
  }

  return {
    state,
    request,
    preview,
    changes,
    schema,
    sql,
    canEdit,
    accept,
    reject,
    modify,
    backToPreview,
    setRejectMessage: (msg: string) => setState({ rejectMessage: msg }),
  }
}
