import { Global } from "../global"

export async function data() {
  const disable = Bun.env.NIKCLI_DISABLE_MODELS_FETCH
  if (disable === "1" || disable === "true") {
    return "{}"
  }
  const path = Bun.env.MODELS_DEV_API_JSON
  if (path) {
    const file = Bun.file(path)
    if (await file.exists()) {
      return await file.text()
    }
  }
  const url = Global.Path.modelsDevUrl
  try {
    const json = await fetch(`${url}/api.json`).then((x) => x.text())
    return json
  } catch {
    return "{}"
  }
}
