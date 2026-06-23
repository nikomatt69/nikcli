import { Browser } from "@/browser/browser";
import { Identifier } from "@/id/id";
import { MessageV2 } from "@/session/message-v2";
import { Tool } from "./tool";
import DESCRIPTION from "./browser.txt";
import z from "zod";
import type { BuModel, ProxyCountryCode } from "browser-use-sdk/v3";
import { Config } from "@/config/config";
import { runPromiseWithLayer, withCurrentInstance } from "@/effect";
import { Effect } from "effect";

const models = Browser.MODELS;

function loadConfig() {
  return runPromiseWithLayer(
    Config.defaultLayer,
    withCurrentInstance(
      Effect.gen(function* () {
        const config = yield* Config.Service;
        const value = yield* config.get();
        return { browser: value.browser, model: value.model };
      }),
    ),
  );
}

/** Map a nikcli model ID to the closest Browser Use model, if any. */
function toBuModel(modelID: string | undefined): BuModel | undefined {
  if (!modelID) return undefined;
  const id = modelID.toLowerCase();
  const exact = models.find((m) => m === id);
  if (exact) return exact;
  if (id.includes("opus") && (id.includes("4.7") || id.includes("4-7")))
    return "claude-opus-4.7";
  if (id.includes("opus") && (id.includes("4.6") || id.includes("4-6")))
    return "claude-opus-4.6";
  if (id.includes("sonnet") && (id.includes("4.6") || id.includes("4-6")))
    return "claude-sonnet-4.6";
  if (id.includes("gemini")) return "gemini-3-flash";
  if (id.includes("gpt-5")) return "gpt-5.4-mini";
  return undefined;
}

function configuredBuModel(modelID: string | undefined): BuModel | undefined {
  if (!modelID) return undefined;
  const model = models.find((candidate) => candidate === modelID);
  if (model) return model;
  throw new Error(`Unsupported Browser Use model in config: ${modelID}`);
}

/** The raw model id driving the current turn, if there is a turn context. */
async function turnModelID(ctx: Tool.Context): Promise<string | undefined> {
  try {
    const msg = await MessageV2.get({
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
    });
    if (msg.info.role === "assistant") return msg.info.modelID;
  } catch {
    // No assistant message context (e.g. background run).
  }
  return undefined;
}

/**
 * The Browser Use model that the session's active model maps to. Prefers the
 * model driving the current turn, then the configured session default
 * (`config.model`), so the browser tool tracks the session's provider/model.
 */
async function sessionAiModel(
  ctx: Tool.Context,
  configModel: string | undefined,
): Promise<BuModel | undefined> {
  const turn = await turnModelID(ctx);
  const sessionModel = turn ?? configModel;
  if (!sessionModel) return undefined;
  // Config model ids are usually "provider/model" — strip the provider prefix.
  const modelID = sessionModel.includes("/")
    ? sessionModel.split("/").slice(1).join("/")
    : sessionModel;
  return toBuModel(modelID);
}

const parameters = z
  .object({
    action: z
      .enum(["run", "status", "messages", "stop"])
      .describe("Browser Use operation"),
    task: z
      .string()
      .min(1)
      .optional()
      .describe("Natural-language browser task for action=run"),
    model: z.enum(models).optional().describe("Browser Use model override"),
    maxCostUsd: z
      .number()
      .positive()
      .max(100)
      .optional()
      .describe("Hard cost cap for this task"),
    profileId: z
      .string()
      .uuid()
      .optional()
      .describe("Browser Use profile id for persisted authentication"),
    proxyCountryCode: z
      .string()
      .length(2)
      .toLowerCase()
      .optional()
      .describe("Two-letter proxy country code"),
    enableRecording: z.boolean().optional().default(false),
  })
  .superRefine((input, ctx) => {
    if (input.action === "run" && !input.task) {
      ctx.addIssue({
        code: "custom",
        path: ["task"],
        message: "task is required for action=run",
      });
    }
  });

type Metadata = {
  surface: "browser";
  provider: "browser-use";
  action: string;
  configured: boolean;
  sessionID?: string;
  liveUrl?: string;
  screenshotUrl?: string;
  status?: string;
  summary?: string;
  stepCount?: number;
  successful?: boolean;
};

function imageAttachment(ctx: Tool.Context, url: string): MessageV2.FilePart {
  return {
    id: Identifier.ascending("part"),
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    type: "file",
    mime: "image/png",
    url,
    filename: "browser-use.png",
  };
}

function baseMetadata(action: string, configured: boolean): Metadata {
  return {
    surface: "browser",
    provider: "browser-use",
    action,
    configured,
  };
}

export const BrowserTool = Tool.define<typeof parameters, Metadata>("browser", {
  description: DESCRIPTION,
  parameters,
  async execute(input, ctx) {
    const configured = await Browser.configured();
    const cfg = await loadConfig();
    // An explicit tool arg wins, then the configured browser default, then the
    // session's active provider/model. Sonnet is the SDK-recommended fallback
    // when the session model has no Browser Use equivalent.
    const model: BuModel =
      input.model ??
      configuredBuModel(cfg.browser?.model) ??
      (await sessionAiModel(ctx, cfg.model)) ??
      "claude-sonnet-4.6";
    const maxCostUsd = input.maxCostUsd ?? cfg.browser?.max_cost_usd ?? 1;
    await ctx.ask({
      permission: "browser",
      patterns: [input.action, input.task ?? "*"],
      always: ["*"],
      metadata: { action: input.action, task: input.task },
    });
    ctx.metadata({
      title:
        input.action === "run"
          ? "Browser Use"
          : `Browser Use · ${input.action}`,
      metadata: baseMetadata(input.action, configured),
    });

    if (input.action === "stop") {
      const stopped = await Browser.close(ctx.sessionID);
      return {
        title: "Browser Use · stop",
        output: stopped
          ? "Browser Use session stopped."
          : "No active Browser Use session.",
        metadata: {
          ...baseMetadata(input.action, configured),
          status: stopped ? "stopped" : "not_started",
        },
      };
    }

    if (input.action === "status") {
      const local = Browser.local(ctx.sessionID);
      const status = await Browser.status(ctx.sessionID);
      return {
        title: "Browser Use · status",
        output: status
          ? `Status: ${status.status}\nSession: ${status.id}\nLive preview: ${status.liveUrl ?? "unavailable"}\nLast step: ${status.lastStepSummary ?? "none"}`
          : configured
            ? "No Browser Use session has been started for this conversation."
            : "Browser Use is not configured. Set BROWSER_USE_API_KEY.",
        metadata: {
          ...baseMetadata(input.action, configured),
          sessionID: status?.id,
          liveUrl: status?.liveUrl ?? local?.liveUrl,
          screenshotUrl: local?.lastScreenshotUrl,
          status: status?.status ?? "not_started",
          summary: status?.lastStepSummary ?? local?.lastSummary,
          stepCount: status?.stepCount,
          successful: status?.isTaskSuccessful ?? undefined,
        },
      };
    }

    if (input.action === "messages") {
      const session = Browser.local(ctx.sessionID);
      const messages = await Browser.messages(ctx.sessionID);
      return {
        title: "Browser Use · messages",
        output:
          messages.length === 0
            ? "No Browser Use activity for this conversation."
            : messages
                .map((message) => `[${message.type}] ${message.summary}`)
                .join("\n"),
        metadata: {
          ...baseMetadata(input.action, configured),
          sessionID: session?.id,
          liveUrl: session?.liveUrl,
          screenshotUrl: session?.lastScreenshotUrl,
          status: session?.running ? "running" : "idle",
          summary: session?.lastSummary,
        },
      };
    }

    const result = await Browser.run(
      ctx.sessionID,
      {
        task: input.task!,
        model,
        maxCostUsd,
        profileId: input.profileId,
        proxyCountryCode: input.proxyCountryCode as
          | ProxyCountryCode
          | undefined,
        enableRecording: input.enableRecording,
      },
      {
        abort: ctx.abort,
        onMessage(message, session) {
          ctx.metadata({
            title: message.summary || "Browser Use",
            metadata: {
              ...baseMetadata("run", configured),
              sessionID: session.id,
              liveUrl: session.liveUrl,
              screenshotUrl: message.screenshotUrl ?? session.lastScreenshotUrl,
              status: "running",
              summary: message.summary,
            },
          });
        },
      },
    );

    const activity = result.messages
      .filter((message) => !message.hidden && !!message.summary)
      .slice(-12)
      .map((message) => `- ${message.summary}`)
      .join("\n");
    const output =
      typeof result.result.output === "string"
        ? result.result.output
        : JSON.stringify(result.result.output);
    const screenshotUrl = result.session.lastScreenshotUrl;

    return {
      title: result.result.title || "Browser Use",
      output: [
        output || "Browser task completed.",
        activity ? `\nRecent activity:\n${activity}` : "",
      ].join("\n"),
      metadata: {
        ...baseMetadata("run", configured),
        sessionID: result.session.id,
        liveUrl: result.session.liveUrl,
        screenshotUrl,
        status: result.result.status,
        summary: result.result.lastStepSummary ?? result.session.lastSummary,
        stepCount: result.result.stepCount,
        successful: result.result.isTaskSuccessful ?? undefined,
      },
      attachments: screenshotUrl
        ? [imageAttachment(ctx, screenshotUrl)]
        : undefined,
    };
  },
});
