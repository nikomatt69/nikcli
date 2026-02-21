import { message } from "@tauri-apps/plugin-dialog"

import { initI18n, t } from "./i18n"

export const UPDATER_ENABLED = false

export async function runUpdater({ alertOnFail }: { alertOnFail: boolean }) {
  if (!alertOnFail) return

  await initI18n()
  await message(t("desktop.updater.none.message"), { title: t("desktop.updater.none.title") })
}
