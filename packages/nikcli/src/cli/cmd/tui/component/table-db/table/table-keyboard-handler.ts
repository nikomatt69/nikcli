import type { TableSelectionManager } from "./table-selection-manager"
import type { TableStateManager } from "./table-state"

export interface KeyboardEvent {
  name: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  char?: string
}

export interface KeyboardHandlerOptions {
  selectionManager: TableSelectionManager
  state: TableStateManager
  totalRows: number
  totalColumns: number
  onEnter?: () => void
  onCtrlC?: () => void
  onCtrlF?: () => void
  onCtrlA?: () => void
  onPageUp?: () => void
  onPageDown?: () => void
  onHome?: () => void
  onEnd?: () => void
  onTab?: (direction: "next" | "prev") => void
  onEscape?: () => void
}

export class TableKeyboardHandler {
  private _options: KeyboardHandlerOptions

  constructor(options: KeyboardHandlerOptions) {
    this._options = options
  }

  handleKey(event: KeyboardEvent): boolean {
    const { name, ctrl, shift, alt, meta } = event

    if (ctrl && !shift && !alt && !meta) {
      return this._handleCtrl(name)
    }

    if (shift && !ctrl && !alt && !meta) {
      return this._handleShift(name)
    }

    if (!ctrl && !shift && !alt && !meta) {
      return this._handlePlain(name)
    }

    return false
  }

  private _handleCtrl(name: string): boolean {
    switch (name) {
      case "a":
        this._options.selectionManager.selectAll()
        this._options.onCtrlA?.()
        return true

      case "c":
        if (this._options.selectionManager.hasSelection) {
          this._options.onCtrlC?.()
          return true
        }
        return false

      case "f":
        this._options.onCtrlF?.()
        return true

      case "home":
        this._options.selectionManager.setFocusedIndex(0)
        return true

      case "end":
        this._options.selectionManager.setFocusedIndex(this._options.totalRows - 1)
        return true

      case "left":
        this._moveToColumn(0)
        return true

      case "right":
        this._moveToColumn(this._options.totalColumns - 1)
        return true

      default:
        return false
    }
  }

  private _handleShift(name: string): boolean {
    switch (name) {
      case "tab":
        this._options.onTab?.("prev")
        return true

      case "arrowdown":
      case "j":
        this._options.selectionManager.selectRange(this._options.selectionManager.focusedIndex + 1)
        return true

      case "arrowup":
      case "k":
        this._options.selectionManager.selectRange(this._options.selectionManager.focusedIndex - 1)
        return true

      case "pageup":
        this._options.onPageUp?.()
        return true

      case "pagedown":
        this._options.onPageDown?.()
        return true

      default:
        return false
    }
  }

  private _handlePlain(name: string): boolean {
    switch (name) {
      case "up":
      case "k":
        this._options.selectionManager.moveUp()
        return true

      case "down":
      case "j":
        this._options.selectionManager.moveDown()
        return true

      case "left":
      case "h":
        this._moveToPreviousColumn()
        return true

      case "right":
      case "l":
        this._moveToNextColumn()
        return true

      case "enter":
      case "return":
        this._options.onEnter?.()
        return true

      case "tab":
        this._options.onTab?.("next")
        return true

      case "home":
        this._options.onHome?.()
        return true

      case "end":
        this._options.onEnd?.()
        return true

      case "pageup":
      case "u":
        this._options.onPageUp?.()
        return true

      case "pagedown":
      case "d":
        this._options.onPageDown?.()
        return true

      case "escape":
      case "esc":
        this._options.onEscape?.()
        return true

      case " ":
        this._options.selectionManager.addSelection(this._options.selectionManager.focusedIndex)
        return true

      case "s":
        if (this._options.state.sortColumn) {
          this._options.state.setSort(this._options.state.sortColumn)
          return true
        }
        return false

      case "f":
        this._options.onCtrlF?.()
        return true

      case "a":
        if (this._options.selectionManager.selectionMode === "multiple") {
          this._options.selectionManager.selectAll()
          return true
        }
        return false

      case "*":
        this._options.selectionManager.selectAll()
        return true

      case "+":
        this._options.selectionManager.addSelection(this._options.selectionManager.focusedIndex)
        return true

      case "-":
        this._options.selectionManager.setSelectedIndex(null)
        return true

      default:
        return false
    }
  }

  private _moveToColumn(columnIndex: number): void {
    this._options.selectionManager.setFocusedIndex(columnIndex)
  }

  private _moveToPreviousColumn(): void {
    this._options.selectionManager.moveLeft()
  }

  private _moveToNextColumn(): void {
    const columnCount = this._options.selectionManager.moveRight()
  }

  static isNavigationKey(name: string): boolean {
    const navKeys = [
      "up",
      "down",
      "left",
      "right",
      "home",
      "end",
      "pageup",
      "pagedown",
      "tab",
      "k",
      "j",
      "h",
      "l",
      "u",
      "d",
    ]
    return navKeys.includes(name)
  }

  static isActionKey(name: string, ctrl?: boolean): boolean {
    if (ctrl) {
      return ["enter", "return", "a", "c", "f"].includes(name)
    }
    return ["enter", "return", " ", "*", "+", "-", "s", "f", "a"].includes(name)
  }
}
