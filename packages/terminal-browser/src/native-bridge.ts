import { dlopen, FFIType, ptr as rawPtr, toArrayBuffer } from "bun:ffi"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveLibraryPath(): string {
  const ext = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so"
  const candidates = [
    resolve(__dirname, `../native/target/release/libterminal_browser.${ext}`),
    resolve(__dirname, `./libterminal_browser.${ext}`),
    resolve(__dirname, `../native/libterminal_browser-${process.platform}-${process.arch}.${ext}`),
  ]

  for (const candidate of candidates) {
    try {
      if (Bun.file(candidate).size > 0) return candidate
    } catch {}
  }

  throw new Error(
    `terminal-browser native library not found. Searched:\n${candidates.map((c) => `  - ${c}`).join("\n")}\n` +
      `Run: cd packages/terminal-browser/native && cargo build --release`,
  )
}

const lib = dlopen(resolveLibraryPath(), {
  tb_decode_image: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  tb_resize_rgba: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32], returns: FFIType.ptr },
  tb_render_cells: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u8], returns: FFIType.ptr },
  tb_buffer_free: { args: [FFIType.ptr], returns: FFIType.void },
})

export interface NativeBuffer {
  data: Uint8Array
  width: number
  height: number
}

function readNativeBuffer(bufPtr: number): NativeBuffer {
  if (!bufPtr) {
    throw new Error("terminal-browser native buffer pointer was null")
  }

  const header = new DataView(toArrayBuffer(bufPtr, 0, 24))
  const dataPtr = Number(header.getBigUint64(0, true))
  const dataLen = Number(header.getBigUint64(8, true))
  const width = header.getUint32(16, true)
  const height = header.getUint32(20, true)

  const view = new Uint8Array(toArrayBuffer(dataPtr as never, 0, dataLen))
  const copy = new Uint8Array(view)
  lib.symbols.tb_buffer_free(bufPtr as never)
  return { data: copy, width, height }
}

export function decodeImage(bytes: Uint8Array): NativeBuffer {
  const ptr = lib.symbols.tb_decode_image(rawPtr(bytes), bytes.byteLength)
  return readNativeBuffer(ptr as unknown as number)
}

export function resizeRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  newWidth: number,
  newHeight: number,
): NativeBuffer {
  const ptr = lib.symbols.tb_resize_rgba(rawPtr(rgba), width, height, newWidth, newHeight)
  return readNativeBuffer(ptr as unknown as number)
}

export function renderCells(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  colorMode: 0 | 1 | 2,
): NativeBuffer {
  const ptr = lib.symbols.tb_render_cells(rawPtr(rgba), width, height, colorMode)
  return readNativeBuffer(ptr as unknown as number)
}
