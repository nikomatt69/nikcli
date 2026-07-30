/**
 * Priming for the patched `@silvia-odwyer/photon-node`.
 *
 * The patch reads `globalThis.__NIKCLI_PHOTON_WASM_PATH` while the module
 * initializes, so the path has to point at the binary's embedded wasm asset
 * *before* the first `import()` — otherwise photon looks for the file next to
 * itself inside bunfs and a compiled binary loses the WASM decoder entirely.
 * Anything that decodes through photon calls this first.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import photonWasm from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" }

type Holder = typeof globalThis & { __NIKCLI_PHOTON_WASM_PATH?: string }

export function preparePhoton() {
  const holder = globalThis as Holder
  if (holder.__NIKCLI_PHOTON_WASM_PATH) return holder.__NIKCLI_PHOTON_WASM_PATH
  const resolved = path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
  holder.__NIKCLI_PHOTON_WASM_PATH = resolved
  return resolved
}
