import { Instance } from "@/project/instance";
import { Log } from "@/util/log";
import { Auth } from "@/auth";
import { runPromiseWithLayer } from "@/effect";
import { Effect } from "effect";
import {
  BrowserUse,
  type BuModel,
  type MessageResponse,
  type ProxyCountryCode,
  type SessionResponse,
  type SessionResult,
} from "browser-use-sdk/v3";

export namespace Browser {
  const log = Log.create({ service: "browser-use" });

  /** Browser Use models the agent can be driven with (matches the SDK's BuModel union). */
  export const MODELS = [
    "bu-mini",
    "bu-max",
    "bu-ultra",
    "gemini-3-flash",
    "claude-sonnet-4.6",
    "claude-opus-4.6",
    "claude-opus-4.7",
    "gpt-5.4-mini",
  ] as const satisfies readonly BuModel[];

  export type Model = (typeof MODELS)[number];

  /**
   * Models billed natively by Browser Use Cloud — usable with only a project
   * key. Every other model in {@link MODELS} requires a bring-your-own
   * provider key configured on the Browser Use project (cloud.browser-use.com),
   * otherwise a run fails at execution time.
   */
  export const NATIVE_MODELS = [
    "claude-sonnet-4.6",
    "claude-opus-4.6",
    "gpt-5.4-mini",
  ] as const satisfies readonly Model[];

  const nativeModelSet = new Set<string>(NATIVE_MODELS);

  /** Whether a model needs a bring-your-own provider key on the BU project. */
  export function requiresOwnKey(model: string | undefined): boolean {
    if (!model) return false;
    return !nativeModelSet.has(model);
  }

  export type Session = {
    id: string;
    liveUrl?: string;
    running: boolean;
    lastSummary?: string;
    lastScreenshotUrl?: string;
  };

  export type RunInput = {
    task: string;
    model?: BuModel;
    maxCostUsd?: number;
    profileId?: string;
    proxyCountryCode?: ProxyCountryCode | null;
    enableRecording?: boolean;
  };

  export type RunOutput = {
    session: Session;
    result: SessionResult<string>;
    messages: MessageResponse[];
  };

  type State = {
    client?: BrowserUse;
    apiKey?: string;
    sessions: Map<string, Session>;
  };

  const state = Instance.state<State>(
    () => ({ sessions: new Map() }),
    async (current) => {
      if (!current.client) return;
      const active = [...current.sessions.values()];
      current.sessions.clear();
      await Promise.allSettled(
        active.map((session) => current.client!.sessions.stop(session.id)),
      );
    },
  );

  async function resolvedApiKey() {
    const env = process.env.BROWSER_USE_API_KEY?.trim();
    if (env) return env;
    const auth = await runPromiseWithLayer(
      Auth.defaultLayer,
      Effect.gen(function* () {
        const service = yield* Auth.Service;
        return yield* service.get("browser-use");
      }),
    );
    return auth?.type === "api" ? auth.key.trim() : undefined;
  }

  async function client() {
    const current = state();
    const apiKey = await resolvedApiKey();
    if (!apiKey) {
      throw new Error(
        "Browser Use is not configured. Set BROWSER_USE_API_KEY to a Browser Use Cloud project key (bu_...).",
      );
    }
    if (current.client && current.apiKey !== apiKey) {
      const previous = current.client;
      const sessions = [...current.sessions.values()];
      current.sessions.clear();
      await Promise.allSettled(
        sessions.map((session) => previous.sessions.stop(session.id)),
      );
      current.client = undefined;
    }
    if (!current.client) {
      current.client = new BrowserUse({ apiKey });
      current.apiKey = apiKey;
    }
    return current.client;
  }

  export async function configured() {
    return !!(await resolvedApiKey());
  }

  export function local(nikcliSessionID: string) {
    return state().sessions.get(nikcliSessionID);
  }

  async function create(
    nikcliSessionID: string,
    input: Omit<RunInput, "task"> = {},
  ) {
    const sdk = await client();
    const created = await sdk.sessions.create({
      keepAlive: true,
      skills: false,
      agentmail: false,
      enableScheduledTasks: false,
      enableRecording: input.enableRecording ?? false,
      ...(input.model ? { model: input.model } : {}),
      ...(input.maxCostUsd !== undefined
        ? { maxCostUsd: input.maxCostUsd }
        : {}),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(input.proxyCountryCode !== undefined
        ? { proxyCountryCode: input.proxyCountryCode }
        : {}),
    });
    const session: Session = {
      id: created.id,
      liveUrl: created.liveUrl ?? undefined,
      running: false,
      lastSummary: created.lastStepSummary ?? undefined,
    };
    state().sessions.set(nikcliSessionID, session);
    return session;
  }

  export async function ensure(
    nikcliSessionID: string,
    input: Omit<RunInput, "task"> = {},
  ) {
    const existing = local(nikcliSessionID);
    if (!existing) return create(nikcliSessionID, input);

    const remote = await (
      await client()
    ).sessions
      .get(existing.id)
      .catch(() => undefined);
    if (remote && !["stopped", "error", "timed_out"].includes(remote.status)) {
      existing.liveUrl = remote.liveUrl ?? existing.liveUrl;
      existing.lastSummary = remote.lastStepSummary ?? existing.lastSummary;
      return existing;
    }

    state().sessions.delete(nikcliSessionID);
    return create(nikcliSessionID, input);
  }

  export async function run(
    nikcliSessionID: string,
    input: RunInput,
    options: {
      abort: AbortSignal;
      onMessage?: (message: MessageResponse, session: Session) => void;
    },
  ): Promise<RunOutput> {
    const sdk = await client();
    const session = await ensure(nikcliSessionID, input);
    if (session.running)
      throw new Error(
        "A Browser Use task is already running for this session.",
      );
    if (options.abort.aborted)
      throw new DOMException("The browser task was aborted", "AbortError");

    session.running = true;
    const messages: MessageResponse[] = [];
    const run = sdk.run(input.task, {
      sessionId: session.id,
      keepAlive: true,
      skills: false,
      agentmail: false,
      enableScheduledTasks: false,
      enableRecording: input.enableRecording ?? false,
      ...(input.model ? { model: input.model } : {}),
      ...(input.maxCostUsd !== undefined
        ? { maxCostUsd: input.maxCostUsd }
        : {}),
      ...(input.proxyCountryCode !== undefined
        ? { proxyCountryCode: input.proxyCountryCode }
        : {}),
    });

    const cancel = () => {
      void sdk.sessions
        .stop(session.id, { strategy: "task" })
        .catch((error) => {
          log.warn("failed to cancel Browser Use task", {
            sessionID: session.id,
            error,
          });
        });
    };
    options.abort.addEventListener("abort", cancel, { once: true });

    try {
      for await (const message of run) {
        messages.push(message);
        session.lastSummary = message.summary || session.lastSummary;
        session.lastScreenshotUrl =
          message.screenshotUrl ?? session.lastScreenshotUrl;
        options.onMessage?.(message, session);
        if (options.abort.aborted)
          throw new DOMException("The browser task was aborted", "AbortError");
      }

      const result = run.result;
      if (!result)
        throw new Error("Browser Use completed without a session result.");
      session.liveUrl = result.liveUrl ?? session.liveUrl;
      session.lastSummary = result.lastStepSummary ?? session.lastSummary;
      return { session, result, messages };
    } catch (error) {
      // The Browser Use project must have a provider key configured for any
      // non-native model. We can't detect that locally, so surface a clear,
      // actionable hint when a bring-your-own-key model fails.
      if (
        requiresOwnKey(input.model) &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Browser Use run failed with "${input.model}". This model is not billed natively — add a provider key for it on your Browser Use project (cloud.browser-use.com → Settings → Model providers), or pick a native model (${NATIVE_MODELS.join(", ")}).\nUnderlying error: ${detail}`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      options.abort.removeEventListener("abort", cancel);
      session.running = false;
    }
  }

  export async function status(
    nikcliSessionID: string,
  ): Promise<SessionResponse | undefined> {
    const session = local(nikcliSessionID);
    if (!session) return;
    return (await client()).sessions.get(session.id);
  }

  export async function messages(nikcliSessionID: string) {
    const session = local(nikcliSessionID);
    if (!session) return [];
    const result = await (
      await client()
    ).sessions.messages(session.id, { limit: 100 });
    return result.messages;
  }

  export async function close(nikcliSessionID: string) {
    const current = state();
    const session = current.sessions.get(nikcliSessionID);
    if (!session) return false;
    current.sessions.delete(nikcliSessionID);
    await (await client()).sessions.stop(session.id);
    return true;
  }
}
