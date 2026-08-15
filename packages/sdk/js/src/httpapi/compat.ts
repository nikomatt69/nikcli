// Namespaced view of the generated Promise client, keyed the way callers are.
//
// Derived once from the shape of the retired hey-api client, then maintained by
// hand. Every entry is a typed reference into `./generated/client.ts`, so a
// codegen rename surfaces here as a typecheck failure rather than a runtime 404.
// See packages/nikcli/AGENTS.md, "HTTP integration workflow".

import { make, type RequestOptions } from "./generated/client.js"
import { ClientError } from "./generated/client-error.js"

type Raw = ReturnType<typeof make>

/**
 * Result envelope. Transport failures and declared HTTP errors resolve as
 * `error` rather than rejecting, so a failed call in a UI event handler cannot
 * become an unhandled rejection. Pass `throwOnError` to opt back into
 * rejection — per call, or once via `createNikcliClient`.
 */
export type Result<A> =
  | { data: A; error: undefined; response?: undefined }
  | { data: undefined; error: unknown; response?: { status: number } }

/**
 * `directory` selects which instance serves the request (the server reads it
 * from `x-nikcli-directory`); it defaults to the client's own directory.
 */
export type CallOptions = RequestOptions & Selector & { readonly throwOnError?: boolean }

/**
 * Instance selection. `directory` picks the instance serving the request and
 * `workspace` the workspace within it; the server reads both from headers
 * (`x-nikcli-directory` / `x-nikcli-workspace`).
 */
type Selector = { readonly directory?: string; readonly workspace?: string }

/** Selection passed inline with the request body. */
type WithDirectory<I> = I & Selector

/** An input the caller may omit entirely: optional parameter, or no required field. */
type Omittable<I> = undefined extends I ? true : {} extends I ? true : false

// Callers of an input-less endpoint historically passed selection in the first
// argument and transport options in the second, so both are accepted and the
// second wins on conflict.
type Result0<F> = F extends (options?: RequestOptions) => Promise<infer R>
  ? (options?: CallOptions, overrides?: CallOptions) => Promise<Result<R>>
  : never
type ResultN<F> = F extends (input: infer I, options?: RequestOptions) => Promise<infer R>
  ? Omittable<I> extends true
    ? (input?: WithDirectory<NonNullable<I>>, options?: CallOptions) => Promise<Result<R>>
    : (input: WithDirectory<I>, options?: CallOptions) => Promise<Result<R>>
  : never
type ResultAt<F> = F extends (input: infer I, options?: RequestOptions) => Promise<infer R>
  ? Omittable<I> extends true
    ? (input?: NonNullable<I>, options?: CallOptions) => Promise<Result<R>>
    : (input: I, options?: CallOptions) => Promise<Result<R>>
  : never
type Stream0<F> = F extends (options?: RequestOptions) => AsyncIterable<infer R>
  ? (options?: CallOptions, overrides?: CallOptions) => Promise<{ stream: AsyncIterable<R> }>
  : never
type StreamN<F> = F extends (input: infer I, options?: RequestOptions) => AsyncIterable<infer R>
  ? Omittable<I> extends true
    ? (input?: WithDirectory<NonNullable<I>>, options?: CallOptions) => Promise<{ stream: AsyncIterable<R> }>
    : (input: WithDirectory<I>, options?: CallOptions) => Promise<{ stream: AsyncIterable<R> }>
  : never

type AnyFn = (...args: any[]) => any

export type CompatDefaults = { readonly throwOnError?: boolean }

function helpers(defaults: CompatDefaults) {
  /**
   * Splits the caller's options into the transport options the generated client
   * understands, folding `directory` into the instance-selection header.
   */
  const request = (options: CallOptions | undefined, inline: Selector | undefined): RequestOptions | undefined => {
    const directory = options?.directory ?? inline?.directory
    const workspace = options?.workspace ?? inline?.workspace
    if (directory === undefined && workspace === undefined) return options
    const headers = new Headers(options?.headers)
    // Header values are latin-1; percent-encode anything outside it.
    if (directory !== undefined) {
      headers.set("x-nikcli-directory", /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory)
    }
    if (workspace !== undefined) headers.set("x-nikcli-workspace", workspace)
    return { ...options, headers }
  }

  /** 5xx and other undeclared statuses arrive as a ClientError carrying the status. */
  const statusOf = (error: unknown): { status: number } | undefined => {
    if (!(error instanceof ClientError)) return undefined
    const cause = error.cause
    if (typeof cause !== "object" || cause === null) return undefined
    const status = (cause as { status?: unknown }).status
    return typeof status === "number" ? { status } : undefined
  }

  const settle = async <A>(promise: Promise<A>, options: CallOptions | undefined): Promise<Result<A>> => {
    try {
      return { data: await promise, error: undefined }
    } catch (error) {
      if (options?.throwOnError ?? defaults.throwOnError) throw error
      return { data: undefined, error, response: statusOf(error) }
    }
  }

  const merge = (a: CallOptions | undefined, b: CallOptions | undefined) =>
    a === undefined ? b : b === undefined ? a : { ...a, ...b }

  const result0 = <F extends AnyFn>(fn: F): Result0<F> =>
    ((a?: CallOptions, b?: CallOptions) => {
      const options = merge(a, b)
      return settle((fn as (o?: RequestOptions) => Promise<unknown>)(request(options, undefined)), options)
    }) as Result0<F>

  /** The generated input has no `directory` of its own, so it selects the instance. */
  const result = <F extends AnyFn>(fn: F): ResultN<F> =>
    ((input: Selector, options?: CallOptions) => {
      const { directory, workspace, ...rest } = input ?? {}
      return settle(
        (fn as (i: unknown, o?: RequestOptions) => Promise<unknown>)(rest, request(options, { directory, workspace })),
        options,
      )
    }) as ResultN<F>

  /** The generated input owns `directory`; the instance comes from the options. */
  const resultAt = <F extends AnyFn>(fn: F): ResultAt<F> =>
    ((input: unknown, options?: CallOptions) =>
      settle(
        (fn as (i: unknown, o?: RequestOptions) => Promise<unknown>)(input, request(options, undefined)),
        options,
      )) as ResultAt<F>

  const stream0 = <F extends AnyFn>(fn: F): Stream0<F> =>
    (async (a?: CallOptions, b?: CallOptions) => ({
      stream: (fn as (o?: RequestOptions) => AsyncIterable<unknown>)(request(merge(a, b), undefined)),
    })) as Stream0<F>

  const stream = <F extends AnyFn>(fn: F): StreamN<F> =>
    (async (input: Selector, options?: CallOptions) => {
      const { directory, workspace, ...rest } = input ?? {}
      return {
        stream: (fn as (i: unknown, o?: RequestOptions) => AsyncIterable<unknown>)(
          rest,
          request(options, { directory, workspace }),
        ),
      }
    }) as StreamN<F>

  return { result0, result, resultAt, stream0, stream }
}

export function compat(raw: Raw, defaults: CompatDefaults = {}) {
  const { result0, result, resultAt, stream0, stream } = helpers(defaults)
  return {
    analytics: {
      daily: result(raw.analytics.daily),
      data: result(raw.analytics.data),
      global: result0(raw.analytics.global),
      leaderboard: result0(raw.analytics.leaderboard),
      session: result(raw.analytics.session),
      sessions: result0(raw.analytics.sessions),
    },
    app: {
      agents: result0(raw["top-level"].agent),
      log: result(raw.app.log),
      skill: {
        create: result(raw.app.skillCreate),
        delete: result(raw.app.skillDelete),
      },
      skills: result0(raw["top-level"].skill),
    },
    auth: {
      remove: result(raw.auth.remove),
      set: result(raw.auth.set),
    },
    brain: {
      status: result0(raw.brain.status),
      trigger: result(raw.brain.trigger),
    },
    command: {
      list: result0(raw["top-level"].command),
    },
    config: {
      get: result0(raw.config.get),
      providers: result0(raw.config.providers),
      reload: result0(raw["config-management"].reload),
      update: result(raw.config.update),
    },
    connectors: {
      auth: {
        remove: result(raw.connectors.authRemove),
        set: result(raw.connectors.authSet),
      },
      invalidate: result(raw.connectors.invalidate),
      status: result0(raw.connectors.status),
    },
    deleteConfigMcpName: result(raw["config-management"].mcpRemove),
    doctor: {
      run: result0(raw.doctor.run),
    },
    event: {
      subscribe: stream0(raw.events.subscribe),
    },
    experimental: {
      resource: {
        list: result0(raw.experimental.resource),
      },
      workspace: {
        adaptor: {
          list: result0(raw.workspace.adaptors),
        },
        create: result(raw.workspace.create),
        events: result(raw["workspace-extra"].events),
        list: result0(raw.workspace.list),
        remove: result(raw.workspace.remove),
        restore: result(raw.workspace.restore),
        session: {
          restore: result(raw.workspace.sessionRestore),
          warp: result(raw["workspace-extra"].sessionWarp),
        },
        status: result0(raw.workspace.status),
        syncList: result0(raw.workspace.syncList),
        warp: result(raw.workspace.warp),
      },
    },
    file: {
      list: result(raw.file.list),
      read: result(raw.file.content),
      status: result0(raw.file.status),
      write: result(raw.file.write),
    },
    find: {
      files: result(raw.file.findFile),
      symbols: result(raw.file.findSymbol),
      text: result(raw.file.findText),
    },
    formatter: {
      status: result0(raw["top-level"].formatter),
    },
    getApiShareShareId: result(raw.share.api),
    getApiShareShareIdData: result(raw.share.data),
    getShareShareId: result(raw.share.page),
    getSShareId: result(raw.share.short),
    global: {
      dispose: result0(raw.global.dispose),
      event: stream0(raw.events.global),
      health: result0(raw.global.health),
    },
    instance: {
      dispose: result0(raw["top-level"].dispose),
    },
    loop: {
      abort: result(raw.loop.abort),
      delete: result(raw.loop.remove),
      generate: result(raw.loop.generate),
      get: result(raw.loop.get),
      list: result0(raw.loop.list),
      pause: result(raw.loop.pause),
      recentRuns: result(raw.loop.recentRuns),
      resume: result(raw.loop.resume),
      run: result(raw.loop.run),
      runs: result(raw.loop.runs),
      templates: result0(raw.loop.templates),
      toggle: result(raw.loop.toggle),
      update: result(raw.loop.update),
      upsert: result(raw.loop.upsert),
    },
    lsp: {
      status: result0(raw["top-level"].lsp),
    },
    managedWorktree: {
      ancestors: result(raw.experimental.managedWorktreeAncestors),
      children: result(raw.experimental.managedWorktreeChildren),
      create: result(raw.experimental.managedWorktreeCreate),
      link: result(raw.experimental.managedWorktreeLink),
      list: result0(raw.experimental.managedWorktreeList),
      remove: result(raw.experimental.managedWorktreeRemove),
    },
    mcp: {
      add: result(raw.mcp.add),
      auth: {
        authenticate: result(raw.mcp.authenticate),
        callback: result(raw.mcp.authCallback),
        remove: result(raw.mcp.removeAuth),
        start: result(raw.mcp.startAuth),
      },
      connect: result(raw.mcp.connect),
      disconnect: result(raw.mcp.disconnect),
      status: result0(raw.mcp.status),
      toggle: result(raw.mcp.toggle),
    },
    mission: {
      cancel: result(raw.mission.cancel),
      delete: result(raw.mission.remove),
      execs: result(raw.mission.execs),
      feature: {
        mutate: result(raw.mission.featureMutate),
      },
      generate: result(raw.mission.generate),
      get: result(raw.mission.get),
      list: result0(raw.mission.list),
      pause: result(raw.mission.pause),
      recentExecs: result(raw.mission.recentExecs),
      start: result(raw.mission.start),
      templates: result0(raw.mission.templates),
      update: result(raw.mission.update),
      upsert: result(raw.mission.upsert),
    },
    mobile: {
      auth: {
        token: {
          create: result(raw.mobile.authTokenCreate),
          list: result0(raw.mobile.authTokenList),
          revoke: result(raw.mobile.authTokenRevoke),
        },
      },
      bootstrap: result0(raw.mobile.bootstrap),
      command: {
        list: result0(raw.mobile.commandList),
      },
      git: {
        branches: result0(raw.mobile.gitBranches),
        checkout: result(raw.mobile.gitCheckout),
        commit: result(raw.mobile.gitCommit),
        commits: result(raw.mobile.gitCommits),
        diff: result(raw.mobile.gitDiff),
        discard: result(raw.mobile.gitDiscard),
        pull: result0(raw.mobile.gitPull),
        push: result(raw.mobile.gitPush),
        stage: result(raw.mobile.gitStage),
        status: result0(raw.mobile.gitStatus),
        unstage: result(raw.mobile.gitUnstage),
      },
      github: {
        auth: {
          remove: result0(raw.mobile.githubAuthRemove),
          set: result(raw.mobile.githubAuthSet),
        },
        branches: result(raw.mobile.githubBranches),
        import: result(raw.mobile.githubImport),
        imports: result0(raw.mobile.githubImports),
        oauth: {
          clientId: {
            set: result(raw.mobile.githubOauthClient),
          },
          device: {
            poll: result(raw.mobile.githubOauthDevicePoll),
            start: result0(raw.mobile.githubOauthDeviceStart),
          },
        },
        repos: result0(raw.mobile.githubRepos),
        session: {
          cleanup: result(raw.mobile.sessionCleanup),
          create: result(raw.mobile.githubSessionCreate),
          publish: result(raw.mobile.sessionPublish),
        },
      },
      loop: {
        abort: result(raw.mobile.loopAbort),
        create: result(raw.mobile.loopCreate),
        delete: result(raw.mobile.loopDelete),
        generate: result(raw.mobile.loopGenerate),
        get: result(raw.mobile.loopGet),
        list: result0(raw.mobile.loopList),
        pause: result(raw.mobile.loopPause),
        resume: result(raw.mobile.loopResume),
        run: result(raw.mobile.loopRun),
        runs: result(raw.mobile.loopRuns),
        runs2: {
          recent: result(raw.mobile.loopRunsRecent),
        },
        templates: result0(raw.mobile.loopTemplates),
        toggle: result(raw.mobile.loopToggle),
        update: result(raw.mobile.loopUpdate),
      },
      memory: {
        history: result0(raw.mobile.memoryHistory),
        search: result(raw.mobile.memorySearch),
        stash: {
          create: result(raw.mobile.memoryStashCreate),
          delete: result(raw.mobile.memoryStashDelete),
          list: result0(raw.mobile.memoryStashList),
        },
      },
      permission: {
        respond: result(raw.mobile.permissionRespond),
      },
      project: {
        list: result0(raw.mobile.projectList),
      },
      pty: {
        create: result(raw.mobile.ptyCreate),
        get: result(raw.mobile.ptyGet),
        list: result0(raw.mobile.ptyList),
        remove: result(raw.mobile.ptyRemove),
        update: result(raw.mobile.ptyUpdate),
      },
      question: {
        reject: result(raw.mobile.questionReject),
        respond: result(raw.mobile.questionRespond),
      },
      routine: {
        create: result(raw.mobile.routineCreate),
        delete: result(raw.mobile.routineDelete),
        get: result(raw.mobile.routineGet),
        list: result0(raw.mobile.routineList),
        pause: result(raw.mobile.routinePause),
        resume: result(raw.mobile.routineResume),
        run: result(raw.mobile.routineRun),
        trigger: result(raw.mobile.routineTrigger),
        update: result(raw.mobile.routineUpdate),
      },
      session: {
        abort: result(raw.mobile.sessionAbort),
        command: result(raw.mobile.sessionCommand),
        command2: {
          list: result(raw.mobile.sessionCommandList),
        },
        create: result(raw.mobile.sessionCreate),
        delete: result(raw.mobile.sessionDelete),
        detail: result(raw.mobile.sessionDetail),
        diff: result(raw.mobile.sessionDiff),
        list: result(raw.mobile.sessionList),
        message: result(raw.mobile.sessionMessage),
        rename: result(raw.mobile.sessionRename),
        stream: stream(raw.mobile.sessionStream),
        teleport: result(raw.mobile.teleportIn),
        teleport2: {
          out: result(raw.mobile.teleportOut),
          upload: {
            begin: result0(raw.mobile.teleportUploadBegin),
            chunk: result(raw.mobile.teleportUploadChunk),
          },
        },
      },
      worktree: {
        create: result(raw.mobile.worktreeCreate),
        remove: result(raw.mobile.worktreeRemove),
        reset: result(raw.mobile.worktreeReset),
      },
    },
    part: {
      delete: result(raw.session.partRemove),
      update: result(raw.session.partUpdate),
    },
    patchConfigMcpName: result(raw["config-management"].mcpUpdate),
    patchUserId: result(raw.users.update),
    path: {
      get: result0(raw["top-level"].path),
    },
    permission: {
      list: result0(raw.permission.list),
      reply: result(raw.permission.reply),
      respond: result(raw.session.permissionRespond),
    },
    postConfigMcp: result(raw["config-management"].mcpAdd),
    postConfigProfiles: result(raw["config-management"].profileCreate),
    postConfigProfilesActivateName: result(raw["config-management"].profileActivate),
    postUserLogin: result(raw.users.login),
    postUserRegister: result(raw.users.register),
    profile: {
      clear: result0(raw.profile.clear),
      clearHabits: result(raw.profile.clearHabits),
      get: result0(raw.profile.get),
      habits: result(raw.profile.habits),
      patch: result(raw.profile.patch),
      preview: result(raw.profile.preview),
    },
    project: {
      current: result0(raw.project.current),
      list: result0(raw.project.list),
      update: result(raw.project.update),
    },
    provider: {
      api: {
        set: result(raw.provider.api),
      },
      auth: result0(raw.provider.auth),
      auth2: {
        remove: result(raw.provider.removeAuth),
      },
      list: result0(raw.provider.list),
      oauth: {
        authorize: result(raw.provider.oauthAuthorize),
        callback: result(raw.provider.oauthCallback),
      },
    },
    pty: {
      create: result(raw.pty.create),
      get: result(raw.pty.get),
      list: result0(raw.pty.list),
      remove: result(raw.pty.remove),
      update: result(raw.pty.update),
    },
    question: {
      list: result0(raw.question.list),
      reject: result(raw.question.reject),
      reply: result(raw.question.reply),
    },
    session: {
      abort: result(raw.session.abort),
      background: result(raw.session.background),
      background2: {
        cancel: result(raw.session.backgroundCancel),
        inspect: result(raw.session.backgroundInspect),
        read: result(raw.session.backgroundRead),
      },
      children: result(raw.session.children),
      command: result(raw.session.command),
      context: result(raw.session.contextBreakdown),
      contextToggle: result(raw.session.contextToggle),
      create: result(raw.session.create),
      delete: result(raw.session.remove),
      diff: result(raw.session.diff),
      fork: result(raw.session.fork),
      get: result(raw.session.get),
      goal: result(raw.session.goal),
      instructions: result(raw.session.instructions),
      list: resultAt(raw.session.list),
      message: result(raw.session.message),
      messages: result(raw.session.messages),
      monitor: result(raw.session.monitor),
      monitorCancel: result(raw.session.monitorCancel),
      monitorLog: result(raw.session.monitorLog),
      pending: result(raw.session.pending),
      pendingSteer: result(raw.session.pendingSteer),
      prompt: result(raw["session-prompt"].prompt),
      promptAsync: result(raw["session-prompt"].promptAsync),
      revert: result(raw.session.revert),
      share: result(raw.session.share),
      shell: result(raw.session.shell),
      status: result0(raw.session.status),
      summarize: result(raw.session.summarize),
      todo: result(raw.session.todo),
      unrevert: result(raw.session.unrevert),
      unshare: result(raw.session.unshare),
      update: result(raw.session.update),
      v2: {
        entries: result(raw.session.v2Entries),
        events: result(raw.session.v2Events),
        state: result(raw.session.v2State),
      },
    },
    sync: {
      config: {
        set: result(raw.sync.config),
      },
      connect: result0(raw.sync.connect),
      disconnect: result0(raw.sync.disconnect),
      drain: result0(raw.sync.drain),
      event: {
        push: result(raw.sync.event),
        stream: stream(raw.sync.stream),
      },
      outbox: {
        list: result(raw.sync.outbox),
      },
      snapshot: {
        get: result(raw.sync.snapshot),
      },
      stats: result(raw.sync.stats),
    },
    tool: {
      ids: result0(raw.experimental.toolIDs),
      list: result(raw.experimental.tools),
    },
    tui: {
      appendPrompt: result(raw.tui.appendPrompt),
      clearPrompt: result0(raw.tui.clearPrompt),
      config: result0(raw.tui.config),
      control: {
        next: result0(raw.tui.controlNext),
        response: result(raw.tui.controlResponse),
      },
      executeCommand: result(raw.tui.executeCommand),
      openHelp: result0(raw.tui.openHelp),
      openModels: result0(raw.tui.openModels),
      openSessions: result0(raw.tui.openSessions),
      openThemes: result0(raw.tui.openThemes),
      publish: result(raw.tui.publish),
      selectSession: result(raw.tui.selectSession),
      showToast: result(raw.tui.showToast),
      submitPrompt: result0(raw.tui.submitPrompt),
    },
    vcs: {
      apply: result(raw["top-level"].vcsApply),
      diff: {
        raw: result0(raw["top-level"].vcsDiffRaw),
      },
      get: result0(raw["top-level"].vcs),
      status: result0(raw["top-level"].vcsStatus),
    },
    worktree: {
      create: result(raw.experimental.worktreeCreate),
      list: result0(raw.experimental.worktree),
      remove: resultAt(raw.experimental.worktreeRemove),
      reset: resultAt(raw.experimental.worktreeReset),
    },
  }
}
