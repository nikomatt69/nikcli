import path from "path"

export namespace Archive {
  export async function extractZip(zipPath: string, destDir: string) {
    if (process.platform === "win32") {
      const winZipPath = path.resolve(zipPath)
      const winDestDir = path.resolve(destDir)
      const proc = Bun.spawn([
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `& {$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force}`,
      ], { stdout: "ignore", stderr: "ignore" })
      await proc.exited
    } else {
      const proc = Bun.spawn(["unzip", "-o", "-q", zipPath, "-d", destDir], { stdout: "ignore", stderr: "ignore" })
      await proc.exited
    }
  }
}
