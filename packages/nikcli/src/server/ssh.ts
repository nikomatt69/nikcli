import type { ConnectConfig } from "ssh2"
import { Server as SshServer } from "ssh2"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { createServer, Server as NetServer } from "net"
import { join, dirname } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

export namespace Ssh {
  const log = Log.create({ service: "ssh" })

  let server: NetServer | undefined
  let sshServer: SshServer | undefined
  let connectedClient: any

  export function start(): NetServer | undefined {
    if (!Flag.NIKCLI_SERVER_SSH_ENABLED) {
      return undefined
    }

    const port = Flag.NIKCLI_SERVER_SSH_PORT
    const host = Flag.NIKCLI_SERVER_SSH_HOST

    log.info("starting SSH server", { host, port })

    sshServer = new SshServer({
      hostKeys: [getOrGenerateHostKey()],
    })

    sshServer.on("connection", (client) => {
      log.info("new SSH connection")
      connectedClient = client

      let authenticated = false
      let username: string | undefined

      client.on("authentication", (ctx) => {
        username = ctx.username

        if (ctx.method === "password") {
          const password = Flag.NIKCLI_SERVER_PASSWORD
          if (password && ctx.password === password) {
            authenticated = true
            ctx.accept()
          } else {
            log.warn("SSH auth failed: invalid password", { username })
            ctx.reject()
          }
        } else if (ctx.method === "publickey") {
          log.warn("SSH auth attempt: publickey not implemented", { username })
          ctx.reject()
        } else {
          ctx.reject()
        }
      })

      client.on("ready", () => {
        log.info("SSH client ready", { username })
      })

      client.on("session", (accept, reject) => {
        if (!authenticated) {
          reject()
          return
        }

        const session = accept()
        session.once("pty", (accept, reject, info) => {
          log.info("SSH pty request", { username, info })
          accept()
        })

        session.once("shell", (accept, reject) => {
          const stream = accept()

          stream.write("Welcome to nikcli SSH shell\r\n")
          stream.write(`Session: ${Date.now()}\r\n\r\n`)
          stream.write("$ ")

          let buffer = ""

          stream.on("data", (data: Buffer) => {
            const str = data.toString()

            for (const char of str) {
              if (char === "\r" || char === "\n") {
                stream.write("\r\n")
                if (buffer.trim()) {
                  handleCommand(buffer.trim(), stream, username)
                }
                buffer = ""
                stream.write("$ ")
              } else if (char === "\x03") {
                buffer = ""
                stream.write("^C\r\n$ ")
              } else if (char === "\x7f") {
                if (buffer.length > 0) {
                  buffer = buffer.slice(0, -1)
                  stream.write("\b \b")
                }
              } else {
                buffer += char
                stream.write(char)
              }
            }
          })

          stream.on("close", () => {
            log.info("SSH session closed", { username })
            client.end()
          })
        })
      })

      client.on("error", (err: Error) => {
        log.error("SSH client error", { error: err, username })
      })

      client.on("close", () => {
        log.info("SSH client disconnected", { username })
      })
    })

    sshServer.on("error", (err: Error) => {
      log.error("SSH server error", { error: err })
    })

    server = createServer((socket) => {
      sshServer!.emit("connection", socket)
    })

    server.listen(port, host, () => {
      log.info("SSH server listening", { host, port })
    })

    return server
  }

  export function stop(): Promise<void> {
    return new Promise((resolve) => {
      if (server) {
        server.close(() => {
          log.info("SSH server stopped")
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  async function handleCommand(cmd: string, stream: any, username?: string): Promise<void> {
    const command = cmd.split(" ")[0]

    switch (command) {
      case "help":
        stream.write("Available commands:\r\n")
        stream.write("  help     - Show this help\r\n")
        stream.write("  whoami   - Show current user\r\n")
        stream.write("  version  - Show nikcli version\r\n")
        stream.write("  exit     - Close SSH connection\r\n")
        break

      case "whoami":
        stream.write(`${username || "unknown"}\r\n`)
        break

      case "version":
        stream.write("nikcli SSH shell\r\n")
        break

      case "exit":
        stream.write("Goodbye!\r\n")
        connectedClient?.end()
        break

      default:
        stream.write(`Unknown command: ${command}\r\n`)
        stream.write("Type 'help' for available commands\r\n")
    }
  }

  function getOrGenerateHostKey(): string {
    const dir = join(import.meta.dir, "../../../.ssh")
    const path = join(dir, "host_rsa_key")

    if (existsSync(path)) {
      return readFileSync(path, "utf-8")
    }

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    log.info("generating SSH host key", { path })

    const { spawnSync } = Bun
    const result = spawnSync(["ssh-keygen", "-t", "rsa", "-b", "2048", "-f", path, "-N", "", "-q"])

    if (result.exitCode !== 0) {
      const errMsg = result.stderr?.toString() || "unknown error"
      throw new Error(`Failed to generate SSH host key: ${errMsg}`)
    }

    return readFileSync(path, "utf-8")
  }
}
