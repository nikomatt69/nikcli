import { createMemo, createSignal, Show } from "solid-js";
import { useSync } from "@tui/context/sync";
import { useDialog } from "@tui/ui/dialog";
import { useSDK } from "../context/sdk";
import { DialogSelect } from "@tui/ui/dialog-select";
import { DialogPrompt } from "../ui/dialog-prompt";
import { useTheme } from "../context/theme";
import { useToast } from "../ui/toast";

const PROVIDER_ID = "browser-use";

const BU_MODELS = [
  "bu-mini",
  "bu-max",
  "bu-ultra",
  "gemini-3-flash",
  "claude-sonnet-4.6",
  "claude-opus-4.6",
  "claude-opus-4.7",
  "gpt-5.4-mini",
] as const;

/**
 * Mirror of Browser.NATIVE_MODELS: models billed natively by Browser Use
 * Cloud. Anything else needs a bring-your-own provider key on the BU project,
 * or its run fails at execution time.
 */
const NATIVE_MODELS = [
  "claude-sonnet-4.6",
  "claude-opus-4.6",
  "gpt-5.4-mini",
] as const;

const requiresOwnKey = (model: string) =>
  !NATIVE_MODELS.includes(model as (typeof NATIVE_MODELS)[number]);

/** Mirror of the server-side mapping: show which Browser Use model the selected AI model maps to. */
function toBuModel(modelID: string | undefined): string | undefined {
  if (!modelID) return undefined;
  const id = modelID.toLowerCase();
  const exact = BU_MODELS.find((m) => m === id);
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

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

/** The Browser Use model the active session provider/model maps to. */
function sessionBuModel(sync: ReturnType<typeof useSync>) {
  const configured = sync.data.config.model;
  const modelID = configured?.includes("/")
    ? configured.split("/").slice(1).join("/")
    : configured;
  return { modelID, mapped: toBuModel(modelID) };
}

/** Human-readable label describing what the session model resolves to. */
function sessionModelLabel(sync: ReturnType<typeof useSync>) {
  const { modelID, mapped } = sessionBuModel(sync);
  if (mapped) return `${modelID} → ${mapped}`;
  return modelID
    ? `${modelID} → claude-sonnet-4.6 fallback`
    : "claude-sonnet-4.6 (default)";
}

function currentModelLabel(sync: ReturnType<typeof useSync>) {
  const browserModel = sync.data.config.browser?.model;
  if (browserModel) return `${browserModel} (browser config)`;
  return sessionModelLabel(sync);
}

/**
 * Browser Use setup dialog. Mirrors the provider connect flow: the API key is
 * stored through the standard auth system (provider id `browser-use`), and the
 * Browser Use task uses the explicit tool model, configured Browser Use
 * default, or the closest supported model for the current turn.
 */
export function DialogBrowserUse() {
  const sync = useSync();
  const dialog = useDialog();

  const options = createMemo(() => {
    const modelLabel = currentModelLabel(sync);
    return [
      {
        title: "Set / update API key",
        value: "key.set",
        description:
          "Browser Use Cloud project key (bu_...) from cloud.browser-use.com",
        category: "Browser Use",
        onSelect() {
          dialog.replace(() => <ApiKeyMethod />);
        },
      },
      {
        title: "AI model",
        value: "model.select",
        description: `Effective Browser Use model: ${modelLabel}. Select a model or use the session default.`,
        category: "Browser Use",
        onSelect() {
          dialog.replace(() => <DialogModelSelect />);
        },
      },
      {
        title: "Remove API key",
        value: "key.remove",
        description: "Disconnect Browser Use and delete the stored key",
        category: "Browser Use",
        onSelect() {
          dialog.replace(() => <RemoveKeyMethod />);
        },
      },
    ];
  });

  return <DialogSelect title="Browser Use" options={options()} />;
}

function ApiKeyMethod() {
  const dialog = useDialog();
  const sdk = useSDK();
  const { theme } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();

  return (
    <DialogPrompt
      title="Browser Use API key"
      placeholder="bu_..."
      busy={busy()}
      busyText="Saving…"
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>
            Get a project key at{" "}
            <span style={{ fg: theme.primary }}>
              https://cloud.browser-use.com
            </span>{" "}
            (starts with <span style={{ fg: theme.accent }}>bu_</span>).
          </text>
          <text fg={theme.textMuted}>
            The key is stored in nikcli's existing local auth vault.
          </text>
          <Show when={error()}>
            <text fg={theme.error}>{error()}</text>
          </Show>
        </box>
      )}
      onConfirm={async (value) => {
        const key = value.trim();
        if (!key) return;
        if (!/^bu_[A-Za-z0-9_-]+$/.test(key)) {
          setError("Enter a valid Browser Use project key starting with bu_.");
          return;
        }
        setBusy(true);
        setError(undefined);
        const result = await sdk.client.auth
          .set({ providerID: PROVIDER_ID, auth: { type: "api", key } })
          .catch((err: unknown) => ({ error: err }));
        setBusy(false);
        if ("error" in result && result.error) {
          setError(errorMessage(result.error));
          return;
        }
        toast.show({ variant: "success", message: "Browser Use connected" });
        dialog.clear();
      }}
    />
  );
}

function RemoveKeyMethod() {
  const dialog = useDialog();
  const sdk = useSDK();
  const toast = useToast();

  return (
    <DialogSelect
      title="Remove Browser Use API key?"
      options={[
        {
          title: "Yes, remove the key",
          value: "yes",
          async onSelect() {
            const result = await sdk.client.auth
              .remove({ providerID: PROVIDER_ID })
              .catch((err: unknown) => ({ error: err }));
            if ("error" in result && result.error) {
              toast.show({
                variant: "error",
                message: errorMessage(result.error),
              });
              return;
            }
            toast.show({ variant: "info", message: "Browser Use key removed" });
            dialog.clear();
          },
        },
        {
          title: "Cancel",
          value: "no",
          onSelect() {
            dialog.clear();
          },
        },
      ]}
    />
  );
}

/**
 * Browser Use model picker. The default keeps the session in sync with the
 * active provider/model (clearing any explicit override), and any of the
 * supported Browser Use models can be pinned as the browser config default.
 */
function DialogModelSelect() {
  const sync = useSync();
  const dialog = useDialog();
  const sdk = useSDK();
  const toast = useToast();

  const current = createMemo(() => sync.data.config.browser?.model);

  const options = createMemo(() => {
    const pinned = current();
    const sessionLabel = sessionModelLabel(sync);

    async function persist(model: string, message: string) {
      const { error } = await sdk.client.config.update({
        config: { browser: { model } } as any,
      });
      if (error) {
        toast.show({ message: "Failed to update Browser Use model", variant: "error" });
        return;
      }
      toast.show({ message, variant: "success" });
      dialog.clear();
    }

    return [
      {
        title: "Use session model (default)",
        value: "__session__",
        description: `Follow the active provider/model: ${sessionLabel}`,
        category: "Default",
        disabled: !pinned,
        // Empty string clears the explicit override so the browser tool maps to
        // whichever model is driving the current turn.
        onSelect: () =>
          persist("", "Browser Use follows the session model"),
      },
      // Native models first so their group renders above the BYO section.
      ...[...BU_MODELS]
        .sort(
          (a, b) => Number(requiresOwnKey(a)) - Number(requiresOwnKey(b)),
        )
        .map((model) => {
        const byo = requiresOwnKey(model);
        const description = byo
          ? "⚠ Needs a provider key on your Browser Use project, or runs fail"
          : model === pinned
            ? "Current browser default"
            : "Native — no extra setup";
        return {
          title: byo ? `${model}  ⚠ BYO key` : model,
          value: model,
          description,
          category: byo
            ? "Bring-your-own-key models"
            : "Native models (no setup)",
          disabled: model === pinned,
          onSelect: () =>
            persist(
              model,
              byo
                ? `Browser Use model set to ${model} (needs a provider key on your BU project)`
                : `Browser Use model set to ${model}`,
            ),
        };
      }),
    ];
  });

  return <DialogSelect title="Browser Use model" options={options()} />;
}
