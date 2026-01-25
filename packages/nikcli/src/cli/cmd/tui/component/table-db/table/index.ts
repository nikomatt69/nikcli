import { extend } from "@opentui/solid"
import { TableRenderable } from "./table-renderable"

extend({ table: TableRenderable })

export { TableRenderable } from "./table-renderable"
export { TableStateManager } from "./table-state"
export { useTable } from "./table-hooks"
export { useDBEdit } from "./dbedit-hooks"
export * from "./types"
export * from "./table-events"
export * from "./table-formatters"
export * from "./table-selection-manager"
export * from "./table-layout-engine"
export * from "./table-keyboard-handler"
