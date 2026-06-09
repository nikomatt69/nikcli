import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { Todo } from "../session/todo"
import { Delegation } from "@/delegation/manager"
import { Monitor } from "@/monitor/manager"
import * as LoopEngine from "@/loop/engine"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import { Effect } from "effect"

function runProject<A, E>(effect: Effect.Effect<A, E, Project.Service>) {
  return runPromiseWithLayer(Project.defaultLayer, effect)
}

function runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>) {
  return runPromiseWithLayer(Plugin.defaultLayer, withCurrentInstance(effect))
}

function runFile<A, E>(effect: Effect.Effect<A, E, File.Service>) {
  return runPromiseWithLayer(File.defaultLayer, withCurrentInstance(effect))
}

function runLSP<A, E>(effect: Effect.Effect<A, E, LSP.Service>) {
  return runPromiseWithLayer(LSP.defaultLayer, withCurrentInstance(effect))
}

// Startup inits that must not block instance creation run fire-and-forget,
// but a rejected promise must never escape as an unhandled rejection.
function background(service: string, promise: Promise<unknown>) {
  void promise.catch((error) => {
    Log.Default.warn("background init failed", { service, error })
  })
}

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await runPlugin(
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      yield* plugin.init()
    }),
  )
  background(
    "share",
    runPromiseWithLayer(
      ShareNext.defaultLayer,
      Effect.gen(function* () {
        const shareNext = yield* ShareNext.Service
        yield* shareNext.init()
      }),
    ),
  )
  background(
    "format",
    runPromiseWithLayer(
      Format.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const format = yield* Format.Service
          yield* format.init()
        }),
      ),
    ),
  )
  await runLSP(
    Effect.gen(function* () {
      const lsp = yield* LSP.Service
      yield* lsp.init()
    }),
  )
  background(
    "file-watcher",
    runPromiseWithLayer(
      FileWatcher.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const fileWatcher = yield* FileWatcher.Service
          yield* fileWatcher.init()
        }),
      ),
    ),
  )
  background(
    "file",
    runFile(
      Effect.gen(function* () {
        const file = yield* File.Service
        yield* file.init()
      }),
    ),
  )
  background(
    "vcs",
    runPromiseWithLayer(
      Vcs.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const vcs = yield* Vcs.Service
          yield* vcs.init()
        }),
      ),
    ),
  )
  background(
    "snapshot",
    runPromiseWithLayer(
      Snapshot.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          yield* snapshot.init()
        }),
      ),
    ),
  )
  background(
    "truncate",
    runPromiseWithLayer(
      Truncate.defaultLayer,
      Effect.gen(function* () {
        const truncate = yield* Truncate.Service
        yield* truncate.init()
      }),
    ),
  )
  background(
    "todo",
    runPromiseWithLayer(
      Todo.defaultLayer,
      withCurrentInstance(
        Effect.gen(function* () {
          const todo = yield* Todo.Service
          yield* todo.init()
        }),
      ),
    ),
  )
  await Delegation.init()
  await Monitor.reconcile().catch((error) => {
    Log.Default.warn("failed to reconcile monitors on startup", { error })
  })
  // Restore headless interval loops for this instance. Safe to call repeatedly.
  await LoopEngine.restore().catch((error) => {
    Log.Default.warn("failed to restore loops on startup", { error })
  })

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await runProject(
        Effect.gen(function* () {
          const project = yield* Project.Service
          yield* project.setInitialized(Instance.project.id)
        }),
      )
    }
  })
}
