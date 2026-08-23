import { Provider } from "@/provider/provider";
import { Session } from ".";
import { MessageV2 } from "./message-v2";
import { Snapshot } from "@/snapshot";
import { Log } from "@nikcli-ai/util/log";
import path from "path";
import { Bus } from "@/bus";
import { LLM } from "./llm";
import { Agent } from "@/agent/agent";
import { SessionDiffRepo } from "./diff-repo";
import { zodObject } from "@nikcli-ai/util/effect-zod";
import { Context, Effect, Layer, Schema } from "effect";
import {
  AppRuntime,
  InstanceState,
  locallyInstance,
  runPromiseWithLayer,
  type InstanceContext,
} from "@/effect";

export namespace SessionSummary {
  const log = Log.create({ service: "session.summary" });

  const SummarizeInputSchema = Schema.Struct({
    sessionID: Schema.String,
    messageID: Schema.String,
  });
  export const SummarizeInput = zodObject(SummarizeInputSchema);
  export type SummarizeInput = Schema.Schema.Type<typeof SummarizeInputSchema>;

  const DiffInputSchema = Schema.Struct({
    sessionID: Schema.String.pipe(Schema.check(Schema.isStartsWith("ses"))),
    messageID: Schema.optional(
      Schema.String.pipe(Schema.check(Schema.isStartsWith("msg"))),
    ),
  });
  export const DiffInput = zodObject(DiffInputSchema);
  export type DiffInput = Schema.Schema.Type<typeof DiffInputSchema>;

  export interface Interface {
    summarize(
      input: SummarizeInput,
    ): Effect.Effect<void, Session.Error, Session.Service>;
    diff(
      input: DiffInput,
    ): Effect.Effect<
      Snapshot.FileDiff[],
      Session.Error,
      Session.Service | Snapshot.Service
    >;
    computeDiff(input: {
      messages: MessageV2.WithParts[];
    }): Effect.Effect<Snapshot.FileDiff[], unknown>;
  }

  export class Service extends Context.Service<Service, Interface>()(
    "SessionSummary.Service",
  ) {}

  function runProvider<A, E>(
    effect: Effect.Effect<A, E, Provider.Service>,
    ctx: InstanceContext,
  ) {
    return runPromiseWithLayer(
      Provider.defaultLayer,
      locallyInstance(ctx, effect),
    );
  }

  function runSession<A, E>(
    effect: Effect.Effect<A, E, Session.Service>,
    ctx: InstanceContext,
  ) {
    return runPromiseWithLayer(
      Session.defaultLayer,
      locallyInstance(ctx, effect),
    );
  }

  async function messagesForSummary(
    ctx: InstanceContext,
    input: { sessionID: string; messageID: string },
  ) {
    const all = await runSession(
      Effect.gen(function* () {
        const session = yield* Session.Service;
        return yield* session.messages({ sessionID: input.sessionID });
      }),
      ctx,
    );
    const anchor = all.find((message) => message.info.id === input.messageID);
    if (!anchor) {
      return {
        all,
        focus: [] as MessageV2.WithParts[],
        rootID: input.messageID,
      };
    }

    const rootID =
      anchor.info.role === "assistant" ? anchor.info.parentID : anchor.info.id;
    return {
      all,
      rootID,
      focus: all.filter(
        (message) =>
          message.info.id === rootID ||
          (message.info.role === "assistant" &&
            message.info.parentID === rootID),
      ),
    };
  }

  const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service;
      const agentService = yield* Agent.Service;

      const computeDiff = (input: { messages: MessageV2.WithParts[] }) =>
        Effect.gen(function* () {
          let from: string | undefined;
          let to: string | undefined;

          for (const item of input.messages) {
            if (!from) {
              for (const part of item.parts) {
                if (part.type === "step-start" && part.snapshot) {
                  from = part.snapshot;
                  break;
                }
              }
            }

            for (const part of item.parts) {
              if (part.type === "step-finish" && part.snapshot) {
                to = part.snapshot;
                break;
              }
            }
          }

          if (from && to) {
            return yield* snapshot.diffFull(from, to);
          }
          return [];
        });

      async function summarizeSession(
        ctx: InstanceContext,
        input: { sessionID: string; messages: MessageV2.WithParts[] },
      ) {
        const files = new Set(
          input.messages
            .flatMap((x) => x.parts)
            .filter((x) => x.type === "patch")
            .flatMap((x) => x.files)
            .map((x) => path.relative(ctx.worktree, x)),
        );
        const diffs = (
          await AppRuntime.runPromise(
            locallyInstance(ctx, computeDiff({ messages: input.messages })),
          )
        ).filter((x) => {
          return files.has(x.file);
        });
        await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service;
            yield* session.update(input.sessionID, (draft) => {
              draft.summary = {
                additions: diffs.reduce((sum, x) => sum + x.additions, 0),
                deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
                files: diffs.length,
              };
            });
          }),
          ctx,
        );
        SessionDiffRepo.upsert(input.sessionID, diffs);
        await Bus.publish(Session.Event.Diff, {
          sessionID: input.sessionID,
          diff: diffs,
        });
      }

      async function summarizeMessage(
        ctx: InstanceContext,
        input: { messageID: string; messages: MessageV2.WithParts[] },
      ) {
        const anchor = input.messages.find(
          (message) => message.info.id === input.messageID,
        );
        if (!anchor) return;
        const rootID =
          anchor.info.role === "assistant"
            ? anchor.info.parentID
            : anchor.info.id;
        const messages = input.messages.filter(
          (message) =>
            message.info.id === rootID ||
            (message.info.role === "assistant" &&
              message.info.parentID === rootID),
        );
        const msgWithParts = messages.find(
          (message) => message.info.id === rootID,
        );
        if (!msgWithParts || msgWithParts.info.role !== "user") return;
        const userMsg = msgWithParts.info as MessageV2.User;
        const diffs = await AppRuntime.runPromise(
          locallyInstance(ctx, computeDiff({ messages })),
        );
        userMsg.summary = {
          ...userMsg.summary,
          diffs,
        };
        await runSession(
          Effect.gen(function* () {
            const session = yield* Session.Service;
            yield* session.updateMessage(userMsg);
          }),
          ctx,
        );

        const textPart = msgWithParts.parts.find(
          (p) => p.type === "text" && !p.synthetic,
        ) as MessageV2.TextPart;
        if (textPart && userMsg.summary?.title === undefined) {
          const agent = await AppRuntime.runPromise(
            locallyInstance(ctx, agentService.get("title")),
          );
          if (!agent) return;
          const model = await runProvider(
            Effect.gen(function* () {
              const provider = yield* Provider.Service;
              if (agent.model)
                return yield* provider.getModel(
                  agent.model.providerID,
                  agent.model.modelID,
                );
              return (
                (yield* provider.getSmallModel(userMsg.model.providerID)) ??
                (yield* provider.getModel(
                  userMsg.model.providerID,
                  userMsg.model.modelID,
                ))
              );
            }),
            ctx,
          );
          const stream = await LLM.stream({
            agent,
            user: userMsg,
            tools: {},
            model,
            small: true,
            messages: [
              {
                role: "user" as const,
                content: `
                  The following is the text to summarize:
                  <text>
                  ${textPart?.text ?? ""}
                  </text>
                `,
              },
            ],
            abort: new AbortController().signal,
            sessionID: userMsg.sessionID,
            system: [],
            retries: 3,
          });
          const result = await stream.text.catch((error) => {
            log.error("failed to generate title", { error });
            return undefined;
          });
          if (!result?.trim()) return;
          log.info("title", { title: result });
          userMsg.summary.title = result;
          await runSession(
            Effect.gen(function* () {
              const session = yield* Session.Service;
              yield* session.updateMessage(userMsg);
            }),
            ctx,
          );
        }
      }

      return Service.of({
        summarize: (input) =>
          InstanceState.context.pipe(
            Effect.flatMap((ctx) =>
              Effect.tryPromise({
                try: async () => {
                  const all = await runSession(
                    Effect.gen(function* () {
                      const session = yield* Session.Service;
                      return yield* session.messages({
                        sessionID: input.sessionID,
                      });
                    }),
                    ctx,
                  );
                  await Promise.all([
                    summarizeSession(ctx, {
                      sessionID: input.sessionID,
                      messages: all,
                    }),
                    summarizeMessage(ctx, {
                      messageID: input.messageID,
                      messages: all,
                    }),
                  ]);
                },
                catch: Session.asSessionError,
              }),
            ),
          ),
        diff: (input) =>
          Effect.gen(function* () {
            // Resolve the session so a missing one rejects on the typed
            // channel instead of silently returning an empty diff (E5.2).
            const sessionSvc = yield* Session.Service;
            yield* sessionSvc.get(input.sessionID);

            if (!input.messageID) {
              return SessionDiffRepo.get(input.sessionID);
            }

            const ctx = yield* InstanceState.context;
            const { focus, rootID } = yield* Effect.tryPromise({
              try: () =>
                messagesForSummary(ctx, {
                  sessionID: input.sessionID,
                  messageID: input.messageID!,
                }),
              catch: Session.asSessionError,
            });
            const root = focus.find((message) => message.info.id === rootID);
            if (root?.info.role === "user" && root.info.summary?.diffs) {
              return root.info.summary.diffs;
            }
            if (!focus.length) return [];
            // `computeDiff` is intentionally `unknown` (real dependency I/O);
            // remap the error union so the route-facing surface stays typed.
            return yield* computeDiff({ messages: focus }).pipe(
              Effect.mapError(Session.asSessionError),
            );
          }),
        computeDiff,
      });
    }),
  );

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(
          Layer.mergeAll(Snapshot.defaultLayer, Agent.defaultLayer),
        ),
      ),
    ),
  );
}
