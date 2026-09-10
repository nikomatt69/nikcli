import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { useAbortOnCleanup } from "@tui/util/lifecycle"
import { stripComments, tuiSource } from "./tui-source"

/**
 * The unmount-during-await race, from both ends.
 *
 * `useAbortOnCleanup` is the primitive: it is exercised for real below. The
 * dialogs that use it are not mounted here — `DialogAccountLogin` alone wants
 * SDK, sync, theme, kv, toast and dialog providers, and `SyncProvider`
 * bootstraps against a live server — so their side is asserted against the
 * source, the same trade `onboarding-auth.test.ts` documents.
 *
 * What the source assertions actually protect: a guard placed after the *first*
 * await only. Aborting is not synchronous with a continuation, so every step
 * after every await has to re-check, and the failure mode of a missing check is
 * silent — a dialog stack that grows one screen after the user left it.
 */
describe("useAbortOnCleanup", () => {
  test("is live until its owner is disposed", () => {
    createRoot((dispose) => {
      const life = useAbortOnCleanup()
      expect(life.disposed()).toBe(false)
      expect(life.signal.aborted).toBe(false)

      dispose()

      expect(life.disposed()).toBe(true)
      expect(life.signal.aborted).toBe(true)
    })
  })

  test("aborts the request it was passed to", () => {
    let aborts = 0
    createRoot((dispose) => {
      const life = useAbortOnCleanup()
      // What an in-flight `fetch` sees: the signal it was handed fires on unmount.
      life.signal.addEventListener("abort", () => {
        aborts++
      })
      expect(aborts).toBe(0)
      dispose()
    })
    expect(aborts).toBe(1)
  })

  test("a resolution that lands after dispose is still catchable", async () => {
    let acted = false
    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const life = useAbortOnCleanup()
        // The request already resolved; the continuation runs after unmount.
        void Promise.resolve("token").then(() => {
          if (life.disposed()) return resolve()
          acted = true
          resolve()
        })
        dispose()
      })
    })
    expect(acted).toBe(false)
  })
})

describe("dialogs that await", () => {
  test("the provider OAuth callback is abortable and re-guarded after every await", async () => {
    const src = stripComments(await tuiSource("component/dialog-provider.tsx"))
    expect(src).toContain("useAbortOnCleanup")
    // The long poll gets the signal, so `esc` ends the request itself.
    expect(src).toMatch(/oauth\.callback\([\s\S]{0,400}?\{ signal: life\.signal \}/)
    // Nothing that mutates the app — instance disposal, the stack — runs
    // unguarded inside the three method components. (`useDisconnectProvider`
    // awaits the same calls from a command handler, which has no unmount to
    // race, so the assertion starts at the first component.)
    const methods = src.slice(src.indexOf("function AutoMethod"))
    for (const line of [
      "await sdk.client.instance.dispose()\n",
      "await sync.bootstrap()\n",
      "await sync.refreshProviders()\n",
    ]) {
      const occurrences = methods.split(line).length - 1
      expect(occurrences).toBeGreaterThan(0)
      const guarded = methods
        .split(line)
        .slice(1)
        .filter((rest) => rest.trimStart().startsWith("if (life.disposed()) return"))
      expect(guarded.length).toBe(occurrences)
    }
  })

  test("account sign-in re-guards after save and rejects a null local user", async () => {
    const src = stripComments(await tuiSource("component/dialog-account-login.tsx"))
    const afterSave = src.split("await UserSession.save(session.data.accessToken)")[1]
    expect(afterSave.trimStart().startsWith("if (disposed) return")).toBe(true)
    const afterMe = src.split("await UserApi.me(sdk)")[1]
    expect(afterMe.trimStart().startsWith("if (disposed) return")).toBe(true)
    // A good issuer token with no local user is a failed sign-in, not a success toast.
    expect(src).toMatch(/if \(!localUser\) throw new Error\(/)
    expect(src.indexOf("if (!localUser) throw")).toBeLessThan(src.indexOf("toast.show({"))
  })

  test("live web preview has a page keyboard under the surface that types into the WebView", async () => {
    const src = stripComments(await tuiSource("component/dialog-web-preview.tsx"))
    expect(src).toContain('type FocusArea = "url" | "content" | "page"')
    expect(src).toContain("function focusPageBar(")
    expect(src).toContain("function submitPageText(")
    expect(src).toContain('placeholder="type into the page')
    expect(src).toContain("sendToPage({ text: v })")
    expect(src).toContain('sendToPage({ key: "enter" })')
    expect(src).toContain('evt.ctrl && evt.name === "k" && live()')
    const contentBox = src.indexOf("height={contentHeight()}")
    const pageBar = src.indexOf('placeholder="type into the page')
    expect(contentBox).toBeGreaterThan(-1)
    expect(pageBar).toBeGreaterThan(contentBox)
  })

  test("a browser surface whose start raced with unmount is still removed", async () => {
    const src = stripComments(await tuiSource("component/browser-surface.tsx"))
    // `started` is only true after the round trip; the cleanup keys on the request.
    expect(src).toContain("if (startRequested && socketPath) {")
    expect(src).not.toContain("if (started && socketPath) {")
    const beforeStart = src.split('await call!("start"')[0]
    expect(beforeStart).toContain("startRequested = true")
  })

  test("a failed shell or slash submit keeps what the user typed", async () => {
    const src = stripComments(await tuiSource("component/prompt/index.tsx"))
    expect(src).toContain("function restoreSubmission(")
    // Restoring is skipped once the composer holds anything again.
    expect(src).toMatch(/function restoreSubmission[\s\S]{0,200}?if \(input\.plainText\.length > 0\) return/)
    // Both fire-and-forget paths inspect the envelope instead of dropping it.
    const shell = src.split("sdk.client.session\n        .shell(")[1] ?? src.split(".shell(")[1]
    expect(shell).toContain('reportSubmitFailure(error, inputText, "shell")')
    expect(src).toContain('reportSubmitFailure(error, inputText, "normal")')
  })

  test("the dialog focus restore is cancellable and loses to a newer dialog", async () => {
    const src = stripComments(await tuiSource("ui/dialog.tsx"))
    expect(src).toContain("function cancelRefocus()")
    // Both timers are tracked — the 30ms reclaim was the untracked one.
    expect(src).toContain("if (reclaimTimer) clearTimeout(reclaimTimer)")
    // `replace` invalidates whatever the dialog it replaces had queued.
    const replaceBody = src.split("replace(input: DialogElement")[1]?.split("batch(")[0] ?? ""
    expect(replaceBody).toContain("cancelRefocus()")
    // A restore only lands on an empty stack.
    expect(src).toMatch(/generation !== refocusGeneration \|\| store\.stack\.length > 0/)
  })

  test("session tab shortcuts do not fire underneath a dialog", async () => {
    const src = stripComments(await tuiSource("component/session-tabs.tsx"))
    const handler = src.split("useKeyboard((event) => {")[1] ?? ""
    expect(handler.trimStart().startsWith("if (dialog.stack.length > 0) return")).toBe(true)
  })
})
