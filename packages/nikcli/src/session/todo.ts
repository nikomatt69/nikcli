import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import z from "zod"
import { Config } from "../config/config"
import { resolveCredential } from "../connectors/credentials"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { zodObject } from "@/util/effect-zod"
import { Context, Effect, Layer, Schema } from "effect"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { TodoRepo } from "./todo-repo"

const log = Log.create({ service: "todo-notifications" })

type MacIcon = {
  value: string
  remote: boolean
}

export namespace Todo {
  export const InfoSchema = Schema.Struct({
    content: Schema.String.annotate({
      description: "Brief description of the task",
    }),
    status: Schema.String.annotate({
      description: "Current status of the task: pending, in_progress, completed, cancelled",
    }),
    priority: Schema.String.annotate({
      description: "Priority level of the task: high, medium, low",
    }),
    id: Schema.String.annotate({
      description: "Unique identifier for the todo item",
    }),
  }).annotate({ identifier: "Todo" })
  export const Info = zodObject(InfoSchema)
  export type Info = Schema.Schema.Type<typeof InfoSchema>

  export const Event = {
    Updated: BusEvent.define(
      "todo.updated",
      z.object({
        sessionID: z.string(),
        todos: z.array(Info),
        diff: z.object({
          added: z.array(Info),
          completed: z.array(Info),
        }),
      }),
    ),
  }

  function done(status: string) {
    return status === "completed" || status === "cancelled"
  }

  function diff(prev: Info[], next: Info[]) {
    const prevMap = new Map(prev.map((todo) => [todo.id, todo]))
    const added = next.filter((todo) => !prevMap.has(todo.id))
    const completed = next.filter((todo) => {
      if (!done(todo.status)) return false
      const old = prevMap.get(todo.id)
      if (!old) return false
      return !done(old.status)
    })
    return { added, completed }
  }

  export interface Interface {
    update(input: { sessionID: string; todos: Info[] }): Effect.Effect<void, unknown>
    get(sessionID: string): Effect.Effect<Info[], unknown>
    init(): Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("Todo.Service") {}

  function runConfig<A, E>(effect: Effect.Effect<A, E, Config.Service>) {
    return runPromiseWithLayer(Config.defaultLayer, withCurrentInstance(effect))
  }

  async function updateImpl(input: { sessionID: string; todos: Info[] }) {
    const prev = await getImpl(input.sessionID)
    const change = diff(prev, input.todos)
    TodoRepo.upsert(input.sessionID, input.todos)
    await Bus.publish(Event.Updated, { ...input, diff: change })
  }

  async function getImpl(sessionID: string) {
    try {
      return TodoRepo.get(sessionID)
    } catch {
      return []
    }
  }

  type ConnectorEntry = NonNullable<Config.Info["connectors"]>[string]

  function isConnector(entry: ConnectorEntry | undefined): entry is Config.Connector {
    return typeof entry === "object" && entry !== null && "type" in entry
  }

  function list(todos: Info[]) {
    return todos.map((todo) => `- ${todo.content} (${todo.priority})`).join("\n")
  }

  function iconPath(value: string) {
    if (!value) return undefined
    if (value === "~") return os.homedir()
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2))
    if (value.startsWith("file://")) return fileURLToPath(value)
    if (path.isAbsolute(value)) return value
    return undefined
  }

  function iconMac(config: Config.Info): MacIcon | undefined {
    const icon = config.notifications?.icon
    if (!icon) return undefined
    const value = icon.url
    if (!value) return undefined
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return { value, remote: true }
    }
    const local = iconPath(value)
    if (!local) return undefined
    return { value: local, remote: false }
  }

  async function macos(config: Config.Info, title: string, body: string) {
    if (process.platform !== "darwin") return
    const icon = iconMac(config)
    const message = body.length ? body : " "

    const notifier = icon && !icon.remote ? Bun.which("terminal-notifier") : null
    if (icon && notifier && !icon.remote) {
      const result = await Bun.$`${notifier} -title ${title} -message ${message} -contentImage ${icon.value}`
        .nothrow()
        .quiet()
      if (result.exitCode === 0) return
    }
    if (!icon) {
      const escapedTitle = title.replace(/"/g, '\\"')
      const escapedBody = body.replace(/"/g, '\\"')
      await Bun.$`osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}"'`.nothrow().quiet()
      return
    }
    const script = `
      ObjC.import('Cocoa')
      const title = ${JSON.stringify(title)}
      const body = ${JSON.stringify(body)}
      const image = ${JSON.stringify(icon.value)}
      const remote = ${JSON.stringify(icon.remote)}
      const notification = $.NSUserNotification.alloc.init
      notification.title = title
      notification.informativeText = body
      const url = remote ? $.NSURL.URLWithString(image) : $.NSURL.fileURLWithPath(image)
      const img = $.NSImage.alloc.initWithContentsOfURL(url)
      if (!img) throw new Error('icon load failed')
      notification.contentImage = img
      const center = $.NSUserNotificationCenter.defaultUserNotificationCenter
      center.deliverNotification(notification)
      $.NSThread.sleepForTimeInterval(0.2)
      if (!notification.presented) throw new Error('notification not presented')
    `
    const result = await Bun.$`osascript -l JavaScript -e ${script}`.nothrow().quiet()
    if (result.exitCode === 0) return
    const escapedTitle = title.replace(/"/g, '\\"')
    const escapedBody = body.replace(/"/g, '\\"')
    await Bun.$`osascript -e 'display notification "${escapedBody}" with title "${escapedTitle}"'`.nothrow().quiet()
  }

  async function slack(config: Config.Info, message: string) {
    const settings = config.notifications?.todo
    if (!settings) return
    const cfg = settings.slack
    if (!cfg) return
    if (cfg.enabled === false) return

    const enabled = cfg.enabled ?? Flag.NIKCLI_SLACK_TASK_NOTIFICATIONS
    if (!enabled) return

    if (!cfg.connector) return
    const name = cfg.connector
    const channel = cfg.channel || Flag.NIKCLI_SLACK_CHANNEL
    if (!channel) return
    const connectors = config.connectors ?? {}
    const entry = connectors[name]
    if (!isConnector(entry)) return
    if (entry.enabled === false) return
    if (entry.type !== "slack") return

    const credential = await resolveCredential(name, entry)
    if (!credential) return
    const api = await import("../connectors/api/slack")
    await api.SlackApi.sendMessage(credential, channel, message).catch((error) => {
      const text = error instanceof Error ? error.message : String(error)
      log.error("failed to send Slack notification", { error: text })
    })
  }

  async function discord(config: Config.Info, message: string) {
    const settings = config.notifications?.todo
    if (!settings) return
    const cfg = settings.discord
    if (!cfg) return
    if (cfg.enabled === false) return

    const enabled = cfg.enabled ?? Flag.NIKCLI_DISCORD_TASK_NOTIFICATIONS
    if (!enabled) return
    const webhook = cfg.webhook || Flag.NIKCLI_DISCORD_WEBHOOK_URL
    if (!webhook) return

    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    })
      .then(async (response) => {
        if (response.ok) return
        const text = await response.text().catch(() => "")
        const detail = text ? `Discord webhook failed: ${text}` : `Discord webhook failed: ${response.status}`
        throw new Error(detail)
      })
      .catch((error) => {
        const text = error instanceof Error ? error.message : String(error)
        log.error("failed to send Discord notification", { error: text })
      })
  }

  async function notify(change: { added: Info[]; completed: Info[] }) {
    const config = await runConfig(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.get()
      }),
    )
    const settings = config.notifications?.todo
    if (!settings) return
    if (settings.enabled === false) return

    const envEnabled =
      Flag.NIKCLI_TODO_NOTIFICATIONS || Flag.NIKCLI_SLACK_TASK_NOTIFICATIONS || Flag.NIKCLI_DISCORD_TASK_NOTIFICATIONS
    const enabled = settings.enabled ?? envEnabled
    if (!enabled) return

    const added = change.added
    const completed = change.completed
    if (added.length === 0 && completed.length === 0) return

    if (added.length > 0) {
      const title = added.length === 1 ? "New Todo Created" : `${added.length} New Todos`
      const body = added.length === 1 ? added[0].content : list(added)
      const slackMessage =
        added.length === 1 ? `New todo: ${added[0].content}` : `${added.length} new todos:\n${list(added)}`
      const discordMessage = slackMessage

      if (settings.macos === true) {
        await macos(config, title, body).catch(() => {})
      }
      await slack(config, slackMessage)
      await discord(config, discordMessage)
    }

    if (completed.length > 0) {
      const title = completed.length === 1 ? "Todo Completed" : `${completed.length} Todos Completed`
      const body = completed.length === 1 ? completed[0].content : list(completed)
      const slackMessage =
        completed.length === 1
          ? `Completed: ${completed[0].content}`
          : `${completed.length} todos completed:\n${list(completed)}`
      const discordMessage = slackMessage

      if (settings.macos === true) {
        await macos(config, title, body).catch(() => {})
      }
      await slack(config, slackMessage)
      await discord(config, discordMessage)
    }
  }

  function initImpl() {
    Bus.subscribe(Event.Updated, async (evt) => {
      await notify(evt.properties.diff)
    })
  }

  const layer = Layer.succeed(
    Service,
    Service.of({
      update: (input) => Effect.tryPromise(() => updateImpl(input)),
      get: (sessionID) => Effect.tryPromise(() => getImpl(sessionID)),
      init: () => Effect.sync(() => initImpl()),
    }),
  )

  export const defaultLayer = layer
}
