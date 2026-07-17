import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import open from "open"
import { Effect } from "effect"
import { Account } from "@/account"
import type { Info as AccountInfo } from "@/account/schema"
import { UserDB } from "@/user/users"
import { runPromiseWithLayer } from "@/effect"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { Clipboard } from "@tui/util/clipboard"

function runAccount<A, E>(effect: Effect.Effect<A, E, Account.Service>): Promise<A> {
  return runPromiseWithLayer(Account.defaultLayer, effect)
}

/**
 * Device-code sign-in to the nikcli account issuer (auth.nikcli.store).
 * On success the identity is also linked to the local user database
 * (`ensureExternalUser` + local session), so one sign-in covers both the
 * account plane and the local TUI/server session. LLM provider credentials
 * (`/connect`, auth.json) and mobile pairing tokens are separate and
 * unaffected.
 */
export function DialogAccountLogin(props: {
  onComplete?: (user: UserDB.PublicUser | null) => void
  clearOnComplete?: boolean
}) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()

  const [active, setActive] = createSignal<AccountInfo>()
  const [start, setStart] = createSignal<Account.LoginStartResult>()
  const [status, setStatus] = createSignal("Contacting auth.nikcli.store…")
  const [error, setError] = createSignal<string>()
  const controller = new AbortController()
  let disposed = false

  onMount(() => {
    void runAccount(
      Effect.gen(function* () {
        const account = yield* Account.Service
        return yield* account.active()
      }),
    )
      .then(setActive)
      .catch(() => undefined)
    void begin()
  })

  onCleanup(() => {
    disposed = true
    controller.abort()
  })

  async function begin() {
    setError(undefined)
    setStart(undefined)
    setStatus("Contacting auth.nikcli.store…")
    try {
      const result = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          return yield* account.login()
        }),
      )
      if (disposed) return
      setStart(result)
      setStatus("Waiting for approval in the browser…")
      await open(result.verificationUrl).catch(() => undefined)
      const session = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          return yield* account.poll(result.deviceCode, {
            signal: controller.signal,
            onPending() {
              if (!disposed) setStatus("Waiting for approval in the browser… (esc to cancel)")
            },
          })
        }),
      )
      if (disposed) return
      const info = await runAccount(
        Effect.gen(function* () {
          const account = yield* Account.Service
          return yield* account.get(session.accountID)
        }),
      )
      let localUser: UserDB.PublicUser | null = null
      if (info?.email) {
        localUser = UserDB.ensureExternalUser({
          sub: session.accountID,
          email: info.email,
        })
        const token = UserDB.createSession(localUser.id, 30)
        await UserDB.saveActiveSession(token)
      }
      toast.show({
        message: info?.email ? `Signed in as ${info.email}` : "Signed in to your nikcli account",
        variant: "success",
      })
      props.onComplete?.(localUser)
      if (props.clearOnComplete !== false) dialog.clear()
    } catch (cause) {
      if (disposed) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus("Sign-in did not complete")
    }
  }

  async function copyCode() {
    const value = start()?.userCode
    if (!value) return
    await Clipboard.copy(value)
      .then(() => toast.show({ message: "Code copied", variant: "success" }))
      .catch(toast.error)
  }

  useKeyboard((event) => {
    if (event.name === "escape") {
      dialog.clear()
      return
    }
    if (!event.ctrl && !event.meta && event.name === "y") {
      event.preventDefault()
      void copyCode()
      return
    }
    if (!event.ctrl && !event.meta && event.name === "r" && error()) {
      event.preventDefault()
      void begin()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Sign in to nikcli
        </text>
        <text fg={theme.textMuted}>esc close</text>
      </box>

      <Show when={active()}>
        {(value) => (
          <text fg={theme.textMuted} wrapMode="word">
            Currently signed in as {value().email} — completing a new sign-in switches the active account.
          </text>
        )}
      </Show>

      <text fg={error() ? theme.error : theme.textMuted} wrapMode="word">
        {error() ?? status()}
      </text>

      <Show when={start()}>
        {(value) => (
          <box flexDirection="column" gap={1}>
            <box flexDirection="column">
              <text fg={theme.textMuted}>Open in your browser</text>
              <text fg={theme.accent} selectable wrapMode="word">
                {value().verificationUrl}
              </text>
            </box>
            <box flexDirection="column">
              <text fg={theme.textMuted}>Enter this code</text>
              <text attributes={TextAttributes.BOLD} fg={theme.primary}>
                {value().userCode}
              </text>
            </box>
          </box>
        )}
      </Show>

      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg={theme.textMuted}>y copy code</text>
        <Show when={error()}>
          <text fg={theme.textMuted}>r retry</text>
        </Show>
        <text fg={theme.textMuted}>esc close</text>
      </box>
    </box>
  )
}
