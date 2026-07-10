import type { RemoteSession } from "./types"
import * as QRCode from "qrcode"

export interface QROptions {
  small?: boolean
  margin?: number
}

export async function generateQRMatrix(value: string): Promise<boolean[][] | null> {
  try {
    // Pairing links contain a full server URL and bearer token. Low error
    // correction keeps the terminal matrix compact while remaining reliably
    // scannable on a high-contrast TUI.
    const modules = QRCode.create(value, { errorCorrectionLevel: "L" }).modules
    const matrix: boolean[][] = []
    for (let row = 0; row < modules.size; row++) {
      const line: boolean[] = []
      for (let column = 0; column < modules.size; column++) {
        line.push(Boolean(modules.get(row, column)))
      }
      matrix.push(line)
    }
    return matrix
  } catch {
    return null
  }
}

export async function generateQR(url: string, options: QROptions = {}): Promise<string> {
  try {
    const qrString = await QRCode.toString(url, {
      type: "terminal",
      small: options.small ?? true,
      margin: options.margin ?? 1,
    })
    return qrString
  } catch {
    return generateFallbackQR(url)
  }
}

export async function generateQRDataURL(url: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      margin: 2,
      width: 256,
      color: { dark: "#000000", light: "#ffffff" },
    })
  } catch {
    return null
  }
}

function generateFallbackQR(url: string): string {
  return `
┌─────────────────────────────────────┐
│                                     │
│   QR Code generation unavailable    │
│                                     │
│   Install 'qrcode' package or       │
│   visit the URL directly:           │
│                                     │
│   ${url.substring(0, 35)}${url.length > 35 ? "..." : ""}
│                                     │
└─────────────────────────────────────┘
`
}

export async function renderSessionCard(session: RemoteSession): Promise<string> {
  const qr = await generateQR(session.qrUrl)
  const statusIcon = getStatusIcon(session.status)
  const statusColor = getStatusColor(session.status)

  const lines = [
    "",
    "╭─────────────────────────────────────────────╮",
    "│           NikCLI Remote Session             │",
    "╰─────────────────────────────────────────────╯",
    "",
  ]

  const qrLines = qr.split("\n").filter((l) => l.trim())
  for (const line of qrLines) {
    lines.push("  " + line)
  }

  lines.push("")
  lines.push("─────────────────────────────────────────────")
  lines.push("")
  lines.push(`  Session:  ${session.id}`)
  lines.push(`  Status:   ${statusColor}${statusIcon} ${session.status}\x1b[0m`)
  lines.push(`  Devices:  ${session.connectedDevices.length} connected`)
  lines.push("")

  if (session.tunnelUrl) {
    lines.push(`  \x1b[36mPublic URL:\x1b[0m`)
    lines.push(`  ${session.tunnelUrl}`)
  } else {
    lines.push(`  \x1b[36mLocal URL:\x1b[0m`)
    lines.push(`  ${session.localUrl}`)
  }

  lines.push("")
  lines.push(`  \x1b[90mScan QR code or open URL on your phone\x1b[0m`)
  lines.push("")
  lines.push("─────────────────────────────────────────────")
  lines.push("  [q] Stop  [r] Refresh  [c] Copy URL")
  lines.push("")

  return lines.join("\n")
}

function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    starting: "◯",
    waiting: "◉",
    connected: "●",
    stopped: "○",
    error: "✖",
  }
  return icons[status] || "?"
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    starting: "\x1b[33m",
    waiting: "\x1b[33m",
    connected: "\x1b[32m",
    stopped: "\x1b[90m",
    error: "\x1b[31m",
  }
  return colors[status] || ""
}

export function progressBar(current: number, total: number, width: number = 30): string {
  const percent = Math.round((current / total) * 100)
  const filled = Math.round((current / total) * width)
  const empty = width - filled
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${percent}%`
}
