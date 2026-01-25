import { createStore } from "solid-js/store"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Portal, useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useKeybind } from "../../context/keybind"
import { useTheme, selectedForeground } from "../../context/theme"
import type { DBEditRequest } from "../../component/table-db/db/types"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { useDBEdit } from "../../component/table-db/table"
import { DBVisualizer } from "../../component/table-db/ui"
import path from "path"
import { Global } from "@/global"
import { Keybind } from "@/util/keybind"

type DBEditStage = "preview" | "edit" | "reject"

function normalizePath(input?: string) {
  if (!input) return ""

  const cwd = process.cwd()
  const home = Global.Path.home
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const relative = path.relative(cwd, absolute)

  if (!relative) return "."
  if (!relative.startsWith("..")) return relative

  if (home && (absolute === home || absolute.startsWith(home + path.sep))) {
    return absolute.replace(home, "~")
  }
  return absolute
}

function TablePreviewBody(props: { preview: NonNullable<DBEditRequest["preview"]> }) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={1}>
      <For each={props.preview.slice(0, 3)}>
        {(table) => (
          <box flexDirection="column" gap={1}>
            <box flexDirection="row" gap={1} paddingLeft={1}>
              <text fg={theme.primary}>▦</text>
              <text fg={theme.text}>{table.tableName}</text>
              <text fg={theme.textMuted}>({table.rowCount} rows)</text>
            </box>
            <Show when={table.columns.length > 0}>
              <box paddingLeft={3} flexDirection="column" gap={0}>
                <For each={table.columns.slice(0, 5)}>
                  {(col) => (
                    <text fg={theme.textMuted}>
                      {col.name} <text fg={theme.textMuted}>{col.type}</text>
                      <Show when={col.notNull}>
                        <text fg={theme.textMuted}> NOT NULL</text>
                      </Show>
                    </text>
                  )}
                </For>
                <Show when={table.columns.length > 5}>
                  <text fg={theme.textMuted}>... and {table.columns.length - 5} more columns</text>
                </Show>
              </box>
            </Show>
          </box>
        )}
      </For>
      <Show when={props.preview.length > 3}>
        <text fg={theme.textMuted}>... and {props.preview.length - 3} more tables</text>
      </Show>
    </box>
  )
}

function SQLBody(props: { sql: string }) {
  const { theme } = useTheme()
  const lines = createMemo(() => props.sql.split("\n").slice(0, 15))

  return (
    <scrollbox height="100%">
      <box flexDirection="column" gap={0}>
        <For each={lines()}>
          {(line, i) => (
            <text
              fg={
                line.trim().startsWith("CREATE")
                  ? theme.success
                  : line.trim().startsWith("DROP")
                    ? theme.error
                    : theme.text
              }
            >
              {line}
            </text>
          )}
        </For>
        <Show when={props.sql.split("\n").length > 15}>
          <text fg={theme.textMuted}>... more</text>
        </Show>
      </box>
    </scrollbox>
  )
}

function EditBody(props: { request: DBEditRequest }) {
  const theme = useTheme().theme

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <text fg={theme.textMuted}>{"→"}</text>
        <text fg={theme.textMuted}>Database {normalizePath(props.request.filePath)}</text>
      </box>
    </box>
  )
}

function DiffBody(props: { changes: NonNullable<DBEditRequest["changes"]> }) {
  const { theme } = useTheme()

  const additions = createMemo(() => props.changes.filter((c) => c.type === "add_table" || c.type === "add_column"))
  const deletions = createMemo(() => props.changes.filter((c) => c.type === "drop_table" || c.type === "drop_column"))
  const modifications = createMemo(() => props.changes.filter((c) => c.type === "modify_column"))

  return (
    <scrollbox height="100%">
      <box flexDirection="column" gap={1}>
        <Show when={additions().length > 0}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.success}>{"+"} Added:</text>
            <For each={additions()}>
              {(change) => (
                <box paddingLeft={2} flexDirection="column" gap={0}>
                  <text fg={theme.success}>
                    {change.type === "add_table" ? "▦" : "→"} {change.tableName}
                    <Show when={change.type === "add_column"}>
                      {`.${change.columnName}`} <text fg={theme.textMuted}>{change.newDefinition?.type}</text>
                    </Show>
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
        <Show when={deletions().length > 0}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.error}>{"-"} Deleted:</text>
            <For each={deletions()}>
              {(change) => (
                <box paddingLeft={2} flexDirection="column" gap={0}>
                  <text fg={theme.error}>
                    {change.type === "drop_table" ? "▦" : "→"} {change.tableName}
                    <Show when={change.type === "drop_column"}>{`.${change.columnName}`}</Show>
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
        <Show when={modifications().length > 0}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.warning}>{"~"} Modified:</text>
            <For each={modifications()}>
              {(change) => (
                <box paddingLeft={2} flexDirection="column" gap={0}>
                  <text fg={theme.warning}>
                    {change.tableName}.{change.columnName}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </box>
    </scrollbox>
  )
}

export function DBEditPrompt(props: { request: DBEditRequest }) {
  const sdk = useSDK()

  const dbeditClient = sdk.client as unknown as {
    dbedit: {
      reply: (params: { reply: string; requestID: string; modified?: DBEditRequest; message?: string }) => Promise<void>
    }
  }

  const { state, preview, schema, sql, canEdit, accept, reject, modify, backToPreview, setRejectMessage } = useDBEdit({
    request: props.request,
    onAccept: (modified) => {
      dbeditClient.dbedit.reply({
        reply: "accept",
        requestID: props.request.id,
        modified: modified as DBEditRequest,
      })
    },
    onReject: (message) => {
      dbeditClient.dbedit.reply({
        reply: "reject",
        requestID: props.request.id,
        message: message,
      })
    },
    onModify: (modified) => {
      dbeditClient.dbedit.reply({
        reply: "edit",
        requestID: props.request.id,
        modified,
      })
    },
  })

  const { theme } = useTheme()

  return (
    <Switch>
      <Match when={state.current === "reject"}>
        <RejectPrompt
          onConfirm={(message) => {
            setRejectMessage(message)
            reject(message)
          }}
          onCancel={() => backToPreview()}
        />
      </Match>
      <Match when={state.current === "preview" || state.current === "edit"}>
        <Prompt
          title={state.current === "edit" ? "Edit Database Schema" : "Database Permission"}
          body={
            <Switch>
              <Match when={sql()}>
                <SQLBody sql={sql()} />
              </Match>
              <Match when={schema() && schema()!.tables.length > 0}>
                <DBVisualizer
                  tables={schema()!.tables}
                  changes={props.request.changes}
                  mode={props.request.changes && props.request.changes.length > 0 ? "diff" : "schema"}
                />
              </Match>
              <Match when={props.request.changes && props.request.changes.length > 0}>
                <DiffBody changes={props.request.changes!} />
              </Match>
              <Match when={preview() && preview()!.length > 0}>
                <TablePreviewBody preview={preview()!} />
              </Match>
              <Match when={true}>
                <EditBody request={props.request} />
              </Match>
            </Switch>
          }
          options={{
            accept: "Accept",
            ...(canEdit() ? { edit: "Edit" } : {}),
            reject: "Reject",
          }}
          escapeKey="reject"
          fullscreen
          onSelect={(option) => {
            if (option === "reject") {
              reject()
              return
            }
            if (option === "edit" && canEdit()) {
              modify(props.request)
              return
            }
            accept()
          }}
        />
      </Match>
    </Switch>
  )
}

function RejectPrompt(props: { onConfirm: (message: string) => void; onCancel: () => void }) {
  let input: TextareaRenderable
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)

  useKeyboard((evt) => {
    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      props.onCancel()
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onConfirm(input.plainText)
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.error}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.error}>{"△"}</text>
          <text fg={theme.text}>Reject database changes</text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>Tell Nikcli what to do differently</text>
        </box>
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
        gap={1}
      >
        <textarea
          ref={(val: TextareaRenderable) => (input = val)}
          focused
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
        />
        <box flexDirection="row" gap={2} flexShrink={0}>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  )
}

function Prompt<const T extends Record<string, string>>(props: {
  title: string
  body: JSX.Element
  options: T
  escapeKey?: keyof T
  fullscreen?: boolean
  onSelect: (option: keyof T) => void
}) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const keys = Object.keys(props.options) as (keyof T)[]
  const [store, setStore] = createStore({
    selected: keys[0],
    expanded: false,
  })
  const diffKey = Keybind.parse("ctrl+f")[0]
  const narrow = createMemo(() => dimensions().width < 80)

  useKeyboard((evt) => {
    if (evt.name === "left" || evt.name == "h") {
      evt.preventDefault()
      const idx = keys.indexOf(store.selected)
      const next = keys[(idx - 1 + keys.length) % keys.length]
      setStore("selected", next)
    }

    if (evt.name === "right" || evt.name == "l") {
      evt.preventDefault()
      const idx = keys.indexOf(store.selected)
      const next = keys[(idx + 1) % keys.length]
      setStore("selected", next)
    }

    if (evt.name === "return") {
      evt.preventDefault()
      props.onSelect(store.selected)
    }

    if (props.escapeKey && (evt.name === "escape" || keybind.match("app_exit", evt))) {
      evt.preventDefault()
      props.onSelect(props.escapeKey)
    }

    if (props.fullscreen && diffKey && Keybind.match(diffKey, keybind.parse(evt))) {
      evt.preventDefault()
      evt.stopPropagation()
      setStore("expanded", (v) => !v)
    }
  })

  const hint = createMemo(() => (store.expanded ? "minimize" : "fullscreen"))

  const content = () => (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.primary}
      customBorderChars={SplitBorder.customBorderChars}
      {...(store.expanded
        ? { top: dimensions().height * -1 + 1, bottom: 1, left: 2, right: 2, position: "absolute" }
        : {
            top: 0,
            maxHeight: 15,
            bottom: 0,
            left: 0,
            right: 0,
            position: "relative",
          })}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1} flexGrow={1}>
        <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
          <text fg={theme.primary}>{"▦"}</text>
          <text fg={theme.text}>{props.title}</text>
        </box>
        {props.body}
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box flexDirection="row" gap={1} flexShrink={0}>
          <For each={keys}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={option === store.selected ? theme.primary : theme.backgroundMenu}
                onMouseOver={() => setStore("selected", option)}
                onMouseUp={() => {
                  setStore("selected", option)
                  props.onSelect(option)
                }}
              >
                <text fg={option === store.selected ? selectedForeground(theme, theme.primary) : theme.textMuted}>
                  {props.options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <Show when={props.fullscreen}>
            <text fg={theme.text}>
              {"ctrl+f"} <span style={{ fg: theme.textMuted }}>{hint()}</span>
            </text>
          </Show>
          <text fg={theme.text}>
            {"⇆"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
        </box>
      </box>
    </box>
  )

  return (
    <Show when={!store.expanded} fallback={<Portal>{content()}</Portal>}>
      {content()}
    </Show>
  )
}
