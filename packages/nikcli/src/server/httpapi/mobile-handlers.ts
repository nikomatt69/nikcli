import { Effect, Layer } from "effect"
import { InstanceState, type InstanceContext } from "@/effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { dispatchMobileRequest } from "../mobile/dispatcher"
import { MobileHttpApi } from "./mobile"
import { Auth } from "./auth"
import { HttpApiAuth } from "./security"
import { MobileHttpError } from "../mobile/request"
import * as auth from "../mobile/auth"
import * as memory from "../mobile/memory"
import * as misc from "../mobile/misc"
import * as github from "../mobile/github"
import * as session from "../mobile/session"
import * as lifecycle from "../mobile/session-lifecycle"
import * as teleport from "../mobile/teleport"
import * as worktree from "../mobile/worktree"
import * as git from "../mobile/git"
import * as loops from "../mobile/loops"
import * as missions from "../mobile/missions"
import * as features from "../mobile/features"
import * as hostStatus from "../mobile/host-status"
import * as pty from "../mobile/pty"

/**
 * Three `/mobile/*` routes stay raw — the two SSE streams and the binary
 * teleport chunk upload. Everything else is an encoded `.handle` that receives
 * the decoded contract payload and answers through the group's response
 * schemas. (`ptyConnect`, the contract-only WebSocket upgrade, also stays raw;
 * the dispatcher has never served it.)
 */
function forward({ request }: { readonly request: HttpServerRequest.HttpServerRequest }) {
  return Effect.promise(async () => {
    // SAFETY: `source` is typed `unknown` because Effect supports several
    // server adapters. nikcli only ever serves this router through
    // `Server.fetch`, i.e. the web-standard adapter, where `source` is the
    // incoming `Request` that adapter was handed.
    const source = request.source as Request
    return (await dispatchMobileRequest(source)) ?? new Response("Not Found", { status: 404 })
  }).pipe(Effect.map(HttpServerResponse.fromWeb))
}

/** The raw `Request` the router authenticated — the same object `Auth.remember` keyed. */
const sourceOf = (request: HttpServerRequest.HttpServerRequest) => request.source as Request

type BadBody = { name: "BadRequest"; error: string }
type UnauthorizedBody = { name: "Unauthorized"; error: string }
type NotFoundBody = { name: "NotFoundError"; error: string }

/**
 * Widen effect's `readonly` decoded payload types back to the mutable shapes
 * the mobile domain helpers are typed with. The contract already ran the
 * payload through its schema, so this is a type-level rebind of a fresh
 * runtime object — not a copy, not a re-validation.
 */
const mutable = <T>(value: T): any => value

/** Endpoint with no declared error: a rejection or throw answers 500, as before. */
const fromPromise = <A>(fn: () => Promise<A>): Effect.Effect<A> => Effect.promise(fn).pipe(Effect.orDie)

/**
 * Endpoint whose body needs the request's instance directory.
 *
 * The mobile git helpers used to open their own `withInstanceAsync({
 * directory: Instance.directory })` — reading the ambient scope in order to
 * re-enter the scope they were already in, which only worked because the
 * caller had put them there. The handler resolves it once and passes it down.
 */
const withDirectory = <A>(fn: (directory: string) => Promise<A>): Effect.Effect<A> =>
  InstanceState.directory.pipe(
    Effect.flatMap((directory) => Effect.promise(() => fn(directory))),
    Effect.orDie,
  )

/** `withDirectory` for a body that needs the project as well as the directory. */
const withInstance = <A>(fn: (instance: InstanceContext) => Promise<A>): Effect.Effect<A> =>
  InstanceState.context.pipe(
    Effect.flatMap((instance) => Effect.promise(() => fn(instance))),
    Effect.orDie,
  )

/** The `withInstance` shape for an endpoint that declares errors. */
const routeWithInstance = <A, E>(
  fn: (instance: InstanceContext) => Promise<A>,
  map: (error: MobileHttpError) => Effect.Effect<never, E>,
): Effect.Effect<A, E> =>
  InstanceState.context.pipe(
    Effect.flatMap((instance) => Effect.promise(() => fn(instance))),
    Effect.catchDefect((cause) => (cause instanceof MobileHttpError ? map(cause) : Effect.die(cause))),
  )

/** The `withDirectory` shape for an endpoint that declares errors. */
const routeWithDirectory = <A, E>(
  fn: (directory: string) => Promise<A>,
  map: (error: MobileHttpError) => Effect.Effect<never, E>,
): Effect.Effect<A, E> =>
  InstanceState.directory.pipe(
    Effect.flatMap((directory) => Effect.promise(() => fn(directory))),
    Effect.catchDefect((cause) => (cause instanceof MobileHttpError ? map(cause) : Effect.die(cause))),
  )

/** Endpoint with declared errors: map a `MobileHttpError` onto the schema. */
const route = <A, E>(
  fn: () => Promise<A>,
  map: (error: MobileHttpError) => Effect.Effect<never, E>,
): Effect.Effect<A, E> =>
  Effect.promise(fn).pipe(
    Effect.catchDefect((cause) => (cause instanceof MobileHttpError ? map(cause) : Effect.die(cause))),
  )

const failBad = (error: MobileHttpError): Effect.Effect<never, BadBody> =>
  Effect.fail({ name: "BadRequest" as const, error: error.message })
const failUnauthorized = (error: MobileHttpError): Effect.Effect<never, UnauthorizedBody> =>
  Effect.fail({ name: "Unauthorized" as const, error: error.message })
const failNotFound = (error: MobileHttpError): Effect.Effect<never, NotFoundBody> =>
  Effect.fail({ name: "NotFoundError" as const, error: error.message })

const catchBad = (error: MobileHttpError): Effect.Effect<never, BadBody> => failBad(error)
const catchUnauthorized = (error: MobileHttpError): Effect.Effect<never, UnauthorizedBody> => failUnauthorized(error)
const catchNotFound = (error: MobileHttpError): Effect.Effect<never, NotFoundBody> => failNotFound(error)
const catchBadOrNotFound = (error: MobileHttpError): Effect.Effect<never, BadBody | NotFoundBody> =>
  error.status === 404 ? failNotFound(error) : failBad(error)
const catchBadOrUnauthorized = (error: MobileHttpError): Effect.Effect<never, BadBody | UnauthorizedBody> =>
  error.status === 401 ? failUnauthorized(error) : failBad(error)

/** Proxied workspace responses pass through byte-for-byte instead of being re-encoded. */
const passthrough = <A>(result: A | Response): A | HttpServerResponse.HttpServerResponse =>
  result instanceof Response ? HttpServerResponse.fromWeb(result) : result

const MobileHandlers = HttpApiBuilder.group(MobileHttpApi.Api, "mobile", (handlers) =>
  handlers
    // --- auth tokens ---
    .handle("authTokenList", () => fromPromise(() => auth.tokenList()))
    .handle("authTokenCreate", ({ payload }) => fromPromise(() => auth.tokenCreate(mutable(payload))))
    .handle("authTokenRevoke", ({ params }) => fromPromise(() => auth.tokenRevoke(params.id)))
    // --- misc ---
    .handle("bootstrap", ({ request }) =>
      withInstance((instance) => {
        const principal = Auth.principal(sourceOf(request))
        return misc.bootstrap(instance, principal?.type === "mobile" ? principal.token : undefined)
      }),
    )
    .handle("commandList", () => fromPromise(() => misc.commandList()))
    .handle("projectList", () => withInstance((instance) => misc.projectList(instance.project)))
    // --- memory ---
    .handle("memoryHistory", () => fromPromise(() => memory.history()))
    .handle("memorySearch", ({ query }) => fromPromise(() => memory.search(query.query)))
    .handle("memoryStashList", () => fromPromise(() => memory.stashList()))
    .handle("memoryStashCreate", ({ payload }) => fromPromise(() => memory.stashCreate(payload)))
    .handle("memoryStashDelete", ({ params }) => route(() => memory.stashDelete(params.id), catchNotFound))
    // --- github ---
    .handle("githubRepos", () => route(() => github.githubRepos(), catchBadOrUnauthorized))
    .handle("githubBranches", ({ params }) =>
      route(() => github.githubBranches(params.owner, params.repo), catchBadOrUnauthorized),
    )
    .handle("githubImports", () => fromPromise(() => github.githubImportsList()))
    .handle("githubOauthClient", ({ payload }) => fromPromise(() => github.githubOauthClient(mutable(payload))))
    .handle("githubOauthDeviceStart", () => route(() => github.githubOauthDeviceStart(), catchBad))
    .handle("githubOauthDevicePoll", ({ payload }) => route(() => github.githubOauthDevicePoll(payload), catchBad))
    .handle("githubAuthSet", ({ payload }) => fromPromise(() => github.githubAuthSet(mutable(payload))))
    .handle("githubAuthRemove", () => fromPromise(() => github.githubAuthRemove()))
    .handle("githubImport", ({ payload }) => route(() => github.githubImport(mutable(payload)), catchUnauthorized))
    .handle("githubSessionCreate", ({ payload }) =>
      route(() => github.githubSessionCreate(mutable(payload)), catchUnauthorized),
    )
    // --- sessions ---
    .handle("sessionList", ({ query }) => fromPromise(() => session.sessionList(query)))
    .handle("sessionCreate", ({ payload }) =>
      withDirectory((directory) => session.sessionCreate(directory, mutable(payload))),
    )
    .handle("sessionDetail", ({ params }) => fromPromise(() => session.sessionDetail(params.sessionID)))
    .handle("sessionDelete", ({ params }) => fromPromise(() => session.sessionDelete(params.sessionID)))
    .handle("sessionDiff", ({ params }) => fromPromise(() => session.sessionDiff(params.sessionID, params.messageID)))
    .handle("sessionCommandList", ({ params, request }) =>
      fromPromise(() => session.sessionCommandList(params.sessionID, sourceOf(request).signal)).pipe(
        Effect.map(passthrough),
      ),
    )
    .handle("sessionCommand", ({ params, payload, request }) =>
      route(() => session.sessionCommand(params.sessionID, mutable(payload), sourceOf(request).signal), catchBad).pipe(
        Effect.map(passthrough),
      ),
    )
    .handle("sessionMessage", ({ params, payload, request }) =>
      route(() => session.sessionMessage(params.sessionID, mutable(payload), sourceOf(request).signal), catchBad).pipe(
        Effect.map(passthrough),
      ),
    )
    .handle("sessionAbort", ({ params, request }) =>
      fromPromise(() => session.sessionAbort(params.sessionID, sourceOf(request).signal)).pipe(Effect.map(passthrough)),
    )
    .handle("permissionRespond", ({ params, payload, request }) =>
      fromPromise(() =>
        session.permissionRespond(params.sessionID, params.permissionID, payload, sourceOf(request).signal),
      ).pipe(Effect.map(passthrough)),
    )
    .handle("questionRespond", ({ params, payload, request }) =>
      fromPromise(() =>
        session.questionRespond(params.sessionID, params.requestID, mutable(payload.answers), sourceOf(request).signal),
      ).pipe(Effect.map(passthrough)),
    )
    .handle("questionReject", ({ params, request }) =>
      fromPromise(() => session.questionReject(params.sessionID, params.requestID, sourceOf(request).signal)).pipe(
        Effect.map(passthrough),
      ),
    )
    .handle("sessionPublish", ({ params, payload }) =>
      route(() => lifecycle.sessionPublish(params.sessionID, mutable(payload)), catchBadOrUnauthorized),
    )
    .handle("sessionCleanup", ({ params }) => route(() => lifecycle.sessionCleanup(params.sessionID), catchBad))
    .handleRaw("sessionStream", forward)
    .handle("sessionRename", ({ params, payload }) =>
      route(() => lifecycle.sessionRename(params.sessionID, payload), catchNotFound),
    )
    .handle("sessionTodo", ({ params }) => fromPromise(() => session.sessionTodo(params.sessionID)))
    // --- teleport ---
    .handle("teleportUploadBegin", () => fromPromise(() => teleport.teleportUploadBegin()))
    .handleRaw("teleportUploadChunk", forward)
    .handle("teleportIn", ({ payload }) =>
      routeWithDirectory((directory) => teleport.teleportIn(directory, mutable(payload)), catchBad),
    )
    .handle("teleportOut", ({ params, payload }) =>
      route(() => teleport.teleportOut(params.sessionID, mutable(payload)), catchBadOrNotFound),
    )
    // --- worktree ---
    .handle("worktreeCreate", ({ payload }) => fromPromise(() => worktree.create(mutable(payload))))
    .handle("worktreeRemove", ({ payload }) => fromPromise(() => worktree.remove(mutable(payload))))
    .handle("worktreeReset", ({ payload }) => fromPromise(() => worktree.reset(mutable(payload))))
    // --- git ---
    .handle("gitStatus", () => withDirectory((directory) => git.gitStatus(directory)))
    .handle("gitDiff", ({ query }) => withDirectory((directory) => git.gitDiff(directory, query)))
    .handle("gitCommits", ({ query }) => withDirectory((directory) => git.gitCommits(directory, query)))
    .handle("gitBranches", () => withDirectory((directory) => git.gitBranches(directory)))
    .handle("gitCommit", ({ payload }) =>
      routeWithDirectory((directory) => git.gitCommit(directory, payload), catchBad),
    )
    .handle("gitCheckout", ({ payload }) => withDirectory((directory) => git.gitCheckout(directory, payload)))
    .handle("gitStage", ({ payload }) => withDirectory((directory) => git.gitFiles(directory, payload, "stage")))
    .handle("gitUnstage", ({ payload }) => withDirectory((directory) => git.gitFiles(directory, payload, "unstage")))
    .handle("gitDiscard", ({ payload }) => withDirectory((directory) => git.gitFiles(directory, payload, "discard")))
    .handle("gitPush", ({ query }) => withDirectory((directory) => git.gitPush(directory, query)))
    .handle("gitPull", () => withDirectory((directory) => git.gitPull(directory)))
    // --- loops ---
    .handle("loopList", () => withInstance((instance) => loops.loopList(instance)))
    .handle("loopCreate", ({ payload }) => routeWithInstance((i) => loops.loopCreate(i, mutable(payload)), catchBad))
    .handle("loopTemplates", () => fromPromise(() => loops.loopTemplates()))
    .handle("loopGenerate", ({ payload }) => fromPromise(() => loops.loopGenerate(mutable(payload))))
    .handle("loopRunsRecent", ({ query }) => withInstance((instance) => loops.loopRunsRecent(instance, query)))
    .handle("loopGet", ({ params }) => routeWithInstance((i) => loops.loopGet(i, params.id), catchNotFound))
    .handle("loopDelete", ({ params }) => routeWithInstance((i) => loops.loopDelete(i, params.id), catchNotFound))
    .handle("loopUpdate", ({ params, payload }) =>
      routeWithInstance((i) => loops.loopUpdate(i, params.id, mutable(payload)), catchBadOrNotFound),
    )
    .handle("loopRuns", ({ params, query }) =>
      routeWithInstance((i) => loops.loopRuns(i, params.id, query), catchNotFound),
    )
    .handle("loopRun", ({ params }) => routeWithInstance((i) => loops.loopRun(i, params.id), catchNotFound))
    .handle("loopAbort", ({ params }) => routeWithInstance((i) => loops.loopAbort(i, params.id), catchNotFound))
    .handle("loopToggle", ({ params, payload }) =>
      routeWithInstance((i) => loops.loopToggle(i, params.id, payload), catchNotFound),
    )
    .handle("loopPause", ({ params }) => routeWithInstance((i) => loops.loopPause(i, params.id), catchNotFound))
    .handle("loopResume", ({ params }) => routeWithInstance((i) => loops.loopResume(i, params.id), catchNotFound))
    // --- routines ---
    .handle("routineList", () => fromPromise(() => loops.routineList()))
    .handle("routineCreate", ({ payload }) => fromPromise(() => loops.routineCreate(mutable(payload))))
    .handle("routineGet", ({ params }) => route(() => loops.routineGet(params.id), catchNotFound))
    .handle("routineDelete", ({ params }) => route(() => loops.routineDelete(params.id), catchNotFound))
    .handle("routineUpdate", ({ params, payload }) =>
      route(() => loops.routineUpdate(params.id, mutable(payload)), catchNotFound),
    )
    .handle("routineRun", ({ params, payload }) =>
      route(() => loops.routineRun(params.id, mutable(payload)), catchNotFound),
    )
    .handle("routinePause", ({ params }) => route(() => loops.routinePause(params.id), catchNotFound))
    .handle("routineResume", ({ params }) => route(() => loops.routineResume(params.id), catchNotFound))
    .handle("routineTrigger", ({ params, payload, request }) =>
      route(() => {
        const bearer = sourceOf(request)
          .headers.get("authorization")
          ?.match(/^Bearer\s+(.+)$/i)?.[1]
          ?.trim()
        return loops.routineTrigger(params.token, mutable(payload), bearer)
      }, catchNotFound),
    )
    // --- pty ---
    .handle("ptyList", () => fromPromise(() => pty.list()))
    .handle("ptyCreate", ({ payload }) => fromPromise(() => pty.create(payload)))
    .handle("ptyGet", ({ params }) => fromPromise(() => pty.get(params.ptyID)))
    .handle("ptyUpdate", ({ params, payload }) => fromPromise(() => pty.update(params.ptyID, mutable(payload))))
    .handle("ptyRemove", ({ params }) => fromPromise(() => pty.remove(params.ptyID)))
    // Contract-only WebSocket upgrade; the dispatcher has never served it and
    // it stays raw for the same reason (see `dispatchMobileRequest`).
    .handleRaw("ptyConnect", forward)
    // --- missions ---
    .handle("missionList", () => fromPromise(() => missions.missionList()))
    .handle("missionCreate", ({ payload }) => route(() => missions.missionCreate(mutable(payload)), catchBad))
    .handle("missionTemplates", () => fromPromise(() => missions.missionTemplates()))
    .handle("missionGenerate", ({ payload }) => route(() => missions.missionGenerate(mutable(payload)), catchBad))
    .handle("missionExecsRecent", ({ query }) => fromPromise(() => missions.missionExecsRecent(query)))
    .handle("missionGet", ({ params }) => route(() => missions.missionGet(params.id), catchNotFound))
    .handle("missionUpdate", ({ params, payload }) =>
      route(() => missions.missionUpdate(params.id, mutable(payload)), catchBadOrNotFound),
    )
    .handle("missionDelete", ({ params }) => route(() => missions.missionDelete(params.id), catchNotFound))
    .handle("missionExecs", ({ params, query }) => route(() => missions.missionExecs(params.id, query), catchNotFound))
    .handle("missionStart", ({ params }) => route(() => missions.missionStart(params.id), catchNotFound))
    .handle("missionPause", ({ params }) => route(() => missions.missionPause(params.id), catchNotFound))
    .handle("missionCancel", ({ params }) => route(() => missions.missionCancel(params.id), catchNotFound))
    .handle("missionFeatureMutate", ({ params, payload }) =>
      route(() => missions.missionFeatureMutate(params.id, params.featureID, mutable(payload)), catchBadOrNotFound),
    )
    // --- live host events ---
    .handleRaw("events", forward)
    // --- operator features ---
    .handle("brainStatus", () => withInstance((instance) => features.brainStatus(instance)))
    .handle("brainTrigger", ({ payload }) =>
      withInstance((instance) => features.brainTrigger(instance, mutable(payload))),
    )
    .handle("chatBotList", () => fromPromise(() => features.chatBotList()))
    .handle("chatBotStart", ({ params }) => fromPromise(() => features.chatBotStart(params.name)))
    .handle("chatBotStop", ({ params }) => fromPromise(() => features.chatBotStop(params.name)))
    .handle("observabilityGet", () => fromPromise(() => features.observabilityGet()))
    .handle("observabilitySet", ({ payload }) => fromPromise(() => features.observabilitySet(payload)))
    .handle("lspStatus", () => fromPromise(() => features.lspStatus()))
    .handle("fusionList", () => fromPromise(() => features.fusionList()))
    .handle("fusionSet", ({ payload }) => fromPromise(() => features.fusionSet(payload)))
    // --- host status ---
    .handle("hostBrowser", () => withDirectory((directory) => hostStatus.hostBrowser(directory)))
    .handle("hostComputer", () => fromPromise(() => hostStatus.hostComputer()))
    .handle("hostHerdrGet", () => fromPromise(() => hostStatus.hostHerdrGet()))
    .handle("hostHerdrSet", ({ payload }) => fromPromise(() => hostStatus.hostHerdrSet(payload)))
    .handle("hostIsland", () => fromPromise(() => hostStatus.hostIsland()))
    .handle("hostDevtools", () => fromPromise(() => hostStatus.hostDevtools())),
)

/** The middleware implementation must be in scope while the group layer is
 * built — `HttpApiBuilder.group` captures the context it resolves middleware
 * from (H8). */
export const MobileHandlersLive = MobileHandlers.pipe(Layer.provide(HttpApiAuth.layer))
