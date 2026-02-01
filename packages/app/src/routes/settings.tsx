import { A } from "@solidjs/router"
import { createEffect, createSignal, Show } from "solid-js"
import { useI18n } from "../i18n"
import { useSettings, useAuth, useServer, useApi } from "../context"

export default function Settings() {
  const { t } = useI18n()
  const { settings, updateSetting } = useSettings()
  const { user, isAuthenticated, login, logout } = useAuth()
  const { status } = useServer()
  const { baseUrl, directory } = useApi()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  // Set title manually
  if (typeof document !== "undefined") {
    document.title = "Settings | NikCLI"
  }

  createEffect(() => {
    const name = user()?.name
    if (!name) return
    setUsername(name)
  })

  const submit = async (event: Event) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    const ok = await login({ username: username(), password: password() })
    if (!ok) {
      setError(t("auth.invalid"))
      setBusy(false)
      return
    }
    setPassword("")
    setBusy(false)
  }

  return (
    <div class="max-w-2xl mx-auto p-8 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen">
      <h1 class="text-3xl font-bold mb-8">{t("settings.title")}</h1>

      <section class="mb-8">
        <h2 class="text-xl font-semibold mb-4">{t("settings.appearance")}</h2>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label>{t("settings.theme")}</label>
            <select
              value={settings().theme}
              onChange={(e) => updateSetting("theme", e.currentTarget.value as "light" | "dark" | "system")}
              class="border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
            >
              <option value="light">{t("settings.light")}</option>
              <option value="dark">{t("settings.dark")}</option>
              <option value="system">{t("settings.system")}</option>
            </select>
          </div>
          <div class="flex items-center justify-between">
            <label>{t("settings.fontSize")}</label>
            <input
              type="number"
              value={settings().fontSize}
              onChange={(e) => updateSetting("fontSize", Number(e.currentTarget.value))}
              class="border rounded px-3 py-2 w-24 dark:bg-gray-800 dark:border-gray-700"
            />
          </div>
        </div>
      </section>

      <section class="mb-8">
        <h2 class="text-xl font-semibold mb-4">{t("settings.editor")}</h2>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label>{t("settings.wordWrap")}</label>
            <input
              type="checkbox"
              checked={settings().wordWrap}
              onChange={(e) => updateSetting("wordWrap", e.currentTarget.checked)}
            />
          </div>
          <div class="flex items-center justify-between">
            <label>{t("settings.showLineNumbers")}</label>
            <input
              type="checkbox"
              checked={settings().showLineNumbers}
              onChange={(e) => updateSetting("showLineNumbers", e.currentTarget.checked)}
            />
          </div>
        </div>
      </section>

      <section class="mb-8">
        <h2 class="text-xl font-semibold mb-4">{t("settings.server")}</h2>
        <div class="space-y-3 text-sm">
          <div class="flex items-center justify-between">
            <span>{t("settings.serverUrl")}</span>
            <span class="font-mono text-xs text-gray-600 dark:text-gray-400">{baseUrl()}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>{t("settings.serverDirectory")}</span>
            <span class="font-mono text-xs text-gray-600 dark:text-gray-400">
              {directory() || t("settings.serverDefault")}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span>{t("settings.serverStatus")}</span>
            <span class={status().connected ? "text-green-600" : "text-red-500"}>
              {status().connected ? t("status.connected") : t("status.disconnected")}
            </span>
          </div>
        </div>
      </section>

      <section class="mb-8">
        <h2 class="text-xl font-semibold mb-4">{t("settings.auth")}</h2>
        <div class="space-y-4">
          <Show when={!isAuthenticated()}>
            <form onSubmit={submit} class="space-y-4">
              <div class="flex items-center justify-between gap-4">
                <label class="w-32 text-sm">{t("auth.username")}</label>
                <input
                  type="text"
                  value={username()}
                  onInput={(event) => setUsername(event.currentTarget.value)}
                  class="flex-1 border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
                />
              </div>
              <div class="flex items-center justify-between gap-4">
                <label class="w-32 text-sm">{t("auth.password")}</label>
                <input
                  type="password"
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                  class="flex-1 border rounded px-3 py-2 dark:bg-gray-800 dark:border-gray-700"
                />
              </div>
              <div class="flex items-center justify-between">
                <button
                  type="submit"
                  disabled={busy()}
                  class="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {busy() ? t("auth.connecting") : t("auth.connect")}
                </button>
                <Show when={error()}>
                  <span class="text-sm text-red-500">{error()}</span>
                </Show>
              </div>
            </form>
          </Show>
          <Show when={isAuthenticated()}>
            <div class="flex items-center justify-between">
              <span class="text-sm">
                {t("auth.connectedAs")} {user()?.name}
              </span>
              <button
                class="text-sm text-red-500 hover:text-red-700"
                onClick={() => {
                  logout()
                }}
              >
                {t("auth.logout")}
              </button>
            </div>
          </Show>
        </div>
      </section>

      <A href="/" class="text-blue-600 hover:underline">
        ← Back to Home
      </A>
    </div>
  )
}
