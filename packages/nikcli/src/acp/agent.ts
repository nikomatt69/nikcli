import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PromptRequest,
  type ResumeSessionRequest,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModelRequest,
  type SetSessionModelResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import type { NikcliClient } from "@nikcli-ai/sdk/httpapi"
import { Log } from "@nikcli-ai/util/log"
import { make, type ACPAgentInterface } from "./service"
import { isACPError, toRequestError } from "./error"
import type { ACPConfig } from "./types"

/**
 * Thin `Agent` wrapper around the `service` layer.
 *
 * The actual protocol logic lives in `service.ts` so it can be unit
 * tested without spinning up a JSON-RPC connection. The Agent is
 * responsible only for:
 *
 * 1. Constructing the service from the `ACPConfig` and the live
 *    `AgentSideConnection`.
 * 2. Bridging the protocol's async methods to the service's typed
 *    errors so the JSON-RPC layer always receives a `RequestError`.
 * 3. Exposing the `ACP.init({ sdk })` factory used by `cmd/acp.ts`.
 */

const log = Log.create({ service: "acp-agent" })

export namespace ACP {
  /**
   * Build an `Agent` factory for the given nikcli client. The factory
   * pattern keeps connection state (subscription, permission handler,
   * session store) scoped to the lifetime of the underlying stream.
   */
  export async function init({ sdk }: { sdk: NikcliClient }) {
    return {
      create: (connection: AgentSideConnection, config: ACPConfig): Agent => {
        return new Agent(sdk, connection, config)
      },
    }
  }

  /**
   * The `Agent` class that implements the `Agent` interface from the
   * `@agentclientprotocol/sdk`. Each method delegates to the service
   * layer and converts typed errors into `RequestError`.
   */
  export class Agent implements ACPAgent {
    private readonly service: ACPAgentInterface
    private readonly connection: AgentSideConnection

    constructor(sdk: NikcliClient, connection: AgentSideConnection, _config: ACPConfig) {
      this.connection = connection
      this.service = make({
        sdk,
        connection: {
          sessionUpdate: connection.sessionUpdate.bind(connection),
          requestPermission: connection.requestPermission?.bind(connection),
          writeTextFile: connection.writeTextFile?.bind(connection),
        },
      })
    }

    initialize(params: InitializeRequest): Promise<InitializeResponse> {
      return run(this.service.initialize(params))
    }

    authenticate(params: AuthenticateRequest) {
      return run(this.service.authenticate(params))
    }

    newSession(params: NewSessionRequest) {
      return run(this.service.newSession(params))
    }

    loadSession(params: LoadSessionRequest) {
      return run(this.service.loadSession(params))
    }

    listSessions(params: ListSessionsRequest) {
      return run(this.service.listSessions(params))
    }

    resumeSession(params: ResumeSessionRequest) {
      return run(this.service.resumeSession(params))
    }

    closeSession(params: CloseSessionRequest) {
      return run(this.service.closeSession(params)) as Promise<CloseSessionResponse>
    }

    forkSession(params: ForkSessionRequest) {
      return run(this.service.forkSession(params)) as Promise<ForkSessionResponse>
    }

    setSessionConfigOption(params: SetSessionConfigOptionRequest) {
      return run(this.service.setSessionConfigOption(params)) as Promise<SetSessionConfigOptionResponse>
    }

    setSessionMode(params: SetSessionModeRequest) {
      return run(this.service.setSessionMode(params)) as Promise<SetSessionModeResponse>
    }

    setSessionModel(params: SetSessionModelRequest) {
      return run(this.service.unstable_setSessionModel(params)) as Promise<SetSessionModelResponse>
    }

    prompt(params: PromptRequest) {
      return run(this.service.prompt(params))
    }

    cancel(params: CancelNotification) {
      return this.service.cancel(params).catch((error) => {
        log.error("cancel failed", { error, sessionId: params.sessionId })
      })
    }
  }
}

/**
 * Convert an exception thrown by the service layer into a JSON-RPC
 * `RequestError`. Typed `ACPError.Error` instances get translated to the
 * right code; anything else is wrapped as an internal error so the
 * boundary never leaks implementation detail.
 */
async function run<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    if (error instanceof RequestError) throw error
    if (isACPError(error)) throw toRequestError(error)
    throw RequestError.internalError({
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

// Re-export so callers that imported from `@/acp/agent` keep getting the
// error helpers without needing a second import.
export { toRequestError } from "./error"
