import crypto from "crypto"
import fs from "fs"
import path from "path"

export function atomicWriteFileSync(filePath: string, data: string, options: BufferEncoding = "utf8"): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(6).toString("hex")}.tmp`)
  try {
    fs.writeFileSync(tempPath, data, options)
    let retries = 5
    while (retries > 0) {
      try {
        fs.renameSync(tempPath, filePath)
        break
      } catch (e) {
        if (retries === 1) throw e
        retries--
        const start = Date.now()
        while (Date.now() - start < 50) {}
      }
    }
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath) } catch (_) {}
    }
    throw err
  }
}
