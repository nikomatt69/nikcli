import { generateQR, renderSessionCard } from "@nikcli-ai/remote"
import type { RemoteSession, SessionStatus } from "./types"

export class QRRenderer {
  async render(session: RemoteSession): Promise<void> {
    console.clear()
    const url = this.addSessionToUrl(this.getSessionUrl(session), session.id)
    const localUrlWithSession = this.addSessionToUrl(session.localUrl || "", session.id)
    const renderSession = {
      ...session,
      qrUrl: url,
      tunnelUrl: session.tunnelUrl ? url : session.tunnelUrl,
      localUrl: session.tunnelUrl ? session.localUrl : localUrlWithSession,
    }

    const card = await renderSessionCard(renderSession as any)
    console.log(card)

    const qr = await generateQR(url)
    console.log(qr)
  }

  updateStatus(session: RemoteSession): void {
    const statusIcon = this.getStatusIcon(session.status)
    const statusText = this.formatStatus(session.status)
    const devices = session.connectedDevices.length

    console.log("")
    console.log(`  Status: ${statusIcon} ${statusText}`)
    console.log(`  Devices: ${devices} connected`)
  }

  renderCompact(session: RemoteSession): string {
    const statusIcon = this.getStatusIcon(session.status)
    const devices = session.connectedDevices.length
    return `${statusIcon} Remote: ${session.id} (${devices} device${devices !== 1 ? "s" : ""})`
  }

  createStatusBadge(session: RemoteSession | null): string {
    if (!session) {
      return "- No remote session"
    }
    const icon = this.getStatusIcon(session.status)
    return `${icon} Remote: ${session.id}`
  }

  private addSessionToUrl(url: string, sessionId: string): string {
    try {
      const parsed = new URL(url)
      if (!parsed.searchParams.has("s")) {
        parsed.searchParams.set("s", sessionId)
      }
      return parsed.toString()
    } catch {
      return url
    }
  }

  private getSessionUrl(session: RemoteSession): string {
    return session.tunnelUrl || session.qrUrl || session.localUrl || ""
  }

  private getStatusIcon(status: SessionStatus): string {
    const icons: Record<SessionStatus, string> = {
      starting: ".",
      waiting: "o",
      connected: "*",
      stopped: "-",
      error: "x",
    }
    return icons[status] ?? "?"
  }

  private formatStatus(status: SessionStatus): string {
    const labels: Record<SessionStatus, string> = {
      starting: "Starting",
      waiting: "Waiting for connection",
      connected: "Connected",
      stopped: "Stopped",
      error: "Error",
    }
    return labels[status] ?? status
  }
}

export const qrRenderer = new QRRenderer()
