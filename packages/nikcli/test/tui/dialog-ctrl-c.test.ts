import { describe, expect, test } from "bun:test"
import { stripComments, tuiSource } from "./tui-source"

/**
 * Ctrl+C in a dialog: close the stack, or let the key through so the user can
 * interrupt a running turn? The answer depends on whether a text editor has
 * focus, and the only thing that knows that is the renderer.
 */
describe("dialog Ctrl+C interactivity", () => {
  test("asks the renderer instead of stringifying the component", async () => {
    const src = await tuiSource("ui/dialog.tsx")
    expect(src).toMatch(/renderer\.currentFocusedEditor !== null/)
    // The stack entry is the wrapper arrow — its source never mentions what the
    // component renders, so this test could never have been right.
    expect(src).not.toMatch(/String\(topElement\)/)
  })

  test("does not probe a DOM that does not exist", async () => {
    // There is no `document` in a terminal: the expression throws if reached.
    // Comments are stripped so the note explaining this fix is not the subject.
    const code = stripComments(await tuiSource("ui/dialog.tsx"))
    expect(code).not.toMatch(/document\.activeElement/)
    expect(code).not.toMatch(/\bdocument\b/)
  })

  test("still clears the stack when nothing is being typed into", async () => {
    const src = await tuiSource("ui/dialog.tsx")
    const branch = src.split("const isInteractive")[1] ?? ""
    expect(branch).toMatch(/if \(!isInteractive\)/)
    expect(branch).toMatch(/setStore\("stack", \[\]\)/)
  })

  test("escape still closes only the top dialog", async () => {
    // The two keys do different things; fixing one must not merge them.
    const src = await tuiSource("ui/dialog.tsx")
    expect(src).toMatch(/evt\.name === "escape" && store\.stack\.length > 0/)
    expect(src).toMatch(/closeTop\(\)/)
  })
})

describe("shared dialog keyboard ownership", () => {
  test("confirm, alert, help, and export consume return instead of leaking it", async () => {
    for (const file of [
      "ui/dialog-confirm.tsx",
      "ui/dialog-alert.tsx",
      "ui/dialog-help.tsx",
      "ui/dialog-export-options.tsx",
    ]) {
      const src = stripComments(await tuiSource(file))
      expect(src).toMatch(/evt\.name === "return"/)
      expect(src).toMatch(/evt\.preventDefault\(\)/)
      expect(src).toMatch(/evt\.stopPropagation\(\)/)
    }
  })

  test("prompt submit can keep a blank value when the caller asks for it", async () => {
    const src = stripComments(await tuiSource("ui/dialog-prompt.tsx"))
    expect(src).toContain("allowEmpty?: boolean")
    expect(src).toMatch(/if \(!val && !props\.allowEmpty\)/)
    const auth = stripComments(await tuiSource("component/dialog-auth-manage.tsx"))
    expect(auth).toMatch(/allowEmpty:\s*true/)
  })
})
