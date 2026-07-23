import { useCallback, useMemo, useState } from "react";
import { ScrollView, Pressable, Text, View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { ActionButton } from "@/components/ui/ActionButton";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { InfoChip } from "@/components/ui/InfoChip";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { TextField } from "@/components/ui/TextField";
import { useServer } from "@/lib/server-context";
import { getAppPreferences, setAppPreferencesWith } from "@/lib/storage";
import { useUIStore } from "@/lib/store";
import { type HostCommandConfig, type PromptPreset } from "@/lib/types";

function optionChipClass(active: boolean) {
  return active
    ? "border-accent/30 bg-accent/12"
    : "border-border bg-background/70";
}

function optionChipTextClass(active: boolean) {
  return active ? "text-accent-light" : "text-ink";
}

function normalizeCommandName(value: string) {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

function isValidCommandName(value: string) {
  return /^[a-z0-9._-]+$/i.test(value);
}

export default function CommandsSettingsScreen() {
  const { client } = useServer();
  const promptPresets = useUIStore((state) => state.promptPresets);
  const setPromptPresets = useUIStore((state) => state.setPromptPresets);
  const composer = useUIStore((state) => state.composer);
  const setComposerPreference = useUIStore(
    (state) => state.setComposerPreference,
  );
  const [hostCommands, setHostCommands] = useState<
    Record<string, HostCommandConfig>
  >({});
  const [catalog, setCatalog] = useState<
    Array<{ name: string; description?: string; badge?: string }>
  >([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commandName, setCommandName] = useState("");
  const [commandDescription, setCommandDescription] = useState("");
  const [commandTemplate, setCommandTemplate] = useState("");
  const [commandAgent, setCommandAgent] = useState("");
  const [commandModel, setCommandModel] = useState("");
  const [commandSubtask, setCommandSubtask] = useState(false);
  const [editingCommandName, setEditingCommandName] = useState<string | null>(
    null,
  );
  const [presetTitle, setPresetTitle] = useState("");
  const [presetPrompt, setPresetPrompt] = useState("");
  const [presetMode, setPresetMode] = useState<"plan" | "code">("code");

  const commandEntries = useMemo(
    () => Object.entries(hostCommands).sort((a, b) => a[0].localeCompare(b[0])),
    [hostCommands],
  );

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setLoading(true);
      const [config, commands] = await Promise.all([
        client.getConfig(),
        client.listHostCommands(),
      ]);
      setHostCommands(
        (config.command as Record<string, HostCommandConfig> | undefined) ?? {},
      );
      setCatalog(
        commands.map((command) => ({
          name: command.name,
          description: command.description,
          badge: command.mcp
            ? "MCP"
            : command.subtask
              ? "Task"
              : command.hints.length
                ? `${command.hints.length} args`
                : undefined,
        })),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function persistPromptPresets(nextPresets: PromptPreset[]) {
    // setAppPreferencesWith merges against the latest stored document
    // (read inside the serialized chain) so two rapid toggles do not race.
    const composerSnapshot = composer;
    await setAppPreferencesWith((current) => ({
      ...current,
      promptPresets: nextPresets,
      composer: {
        ...current.composer,
        defaultMode: composerSnapshot.defaultMode,
        autoFollowTranscript: composerSnapshot.autoFollowTranscript,
        slashSuggestions: composerSnapshot.slashSuggestions,
      },
    }));
    setPromptPresets(nextPresets);
  }

  async function persistComposerPreference<K extends keyof typeof composer>(
    key: K,
    value: (typeof composer)[K],
  ) {
    const nextComposer = {
      ...composer,
      [key]: value,
    };
    setComposerPreference(key, value);
    const presetsSnapshot = promptPresets;
    await setAppPreferencesWith((current) => ({
      ...current,
      composer: nextComposer,
      promptPresets: presetsSnapshot,
    }));
  }

  async function saveHostCommands(
    nextCommands: Record<string, HostCommandConfig>,
    successMessage: string,
  ) {
    if (!client) return;
    try {
      setSaving(true);
      setMessage(null);
      const config = await client.getConfig();
      await client.updateConfig({
        ...config,
        command: nextCommands,
      });
      setHostCommands(nextCommands);
      await load();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function addCommand() {
    const name = normalizeCommandName(commandName);
    if (!name || !commandTemplate.trim()) {
      setMessage("Command name and template are required");
      return;
    }
    if (!isValidCommandName(name)) {
      setMessage(
        "Command names may only contain letters, numbers, dots, dashes, and underscores",
      );
      return;
    }
    if (
      (editingCommandName !== name &&
        catalog.some((command) => command.name.toLowerCase() === name)) ||
      (editingCommandName !== name && hostCommands[name])
    ) {
      setMessage(`A command named /${name} already exists on this host`);
      return;
    }
    const nextCommands = {
      ...hostCommands,
      [name]: {
        template: commandTemplate.trim(),
        description: commandDescription.trim() || undefined,
        agent: commandAgent.trim() || undefined,
        model: commandModel.trim() || undefined,
        subtask: commandSubtask || undefined,
      },
    };
    if (editingCommandName && editingCommandName !== name) {
      delete nextCommands[editingCommandName];
    }
    await saveHostCommands(
      nextCommands,
      `${editingCommandName ? "Updated" : "Saved"} command /${name}`,
    );
    setCommandName("");
    setCommandDescription("");
    setCommandTemplate("");
    setCommandAgent("");
    setCommandModel("");
    setCommandSubtask(false);
    setEditingCommandName(null);
  }

  async function removeCommand(name: string) {
    const nextCommands = { ...hostCommands };
    delete nextCommands[name];
    await saveHostCommands(nextCommands, `Removed command /${name}`);
  }

  function editCommand(name: string, command: HostCommandConfig) {
    setEditingCommandName(name);
    setCommandName(name);
    setCommandDescription(command.description ?? "");
    setCommandTemplate(command.template);
    setCommandAgent(command.agent ?? "");
    setCommandModel(command.model ?? "");
    setCommandSubtask(Boolean(command.subtask));
  }

  function cancelEditing() {
    setEditingCommandName(null);
    setCommandName("");
    setCommandDescription("");
    setCommandTemplate("");
    setCommandAgent("");
    setCommandModel("");
    setCommandSubtask(false);
  }

  async function addPreset() {
    if (!presetTitle.trim() || !presetPrompt.trim()) {
      setMessage("Preset title and prompt are required");
      return;
    }
    const nextPresets = [
      ...promptPresets,
      {
        id: `preset-${Date.now()}`,
        title: presetTitle.trim(),
        prompt: presetPrompt.trim(),
        mode: presetMode,
      },
    ];
    await persistPromptPresets(nextPresets);
    setPresetTitle("");
    setPresetPrompt("");
    setPresetMode("code");
    setMessage("Saved local prompt preset");
  }

  async function removePreset(id: string) {
    await persistPromptPresets(
      promptPresets.filter((preset) => preset.id !== id),
    );
    setMessage("Removed local prompt preset");
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "Commands" }} />

      <SurfaceCard
        eyebrow="Command center"
        title="Custom commands and presets"
        description="Scale the mobile command palette with host commands, local reusable prompts, and composer defaults tuned to your workflow."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip
            label={`${commandEntries.length} host commands`}
            tone="accent"
          />
          <InfoChip label={`${promptPresets.length} local presets`} />
          <InfoChip label={`${catalog.length} resolved commands`} tone="good" />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      <SurfaceCard
        eyebrow="Composer defaults"
        title="How new sessions behave"
        description="Personalize mode, transcript follow, and slash assist so every session starts the way you prefer."
      >
        <View className="flex-row flex-wrap gap-2">
          {(["code", "plan"] as const).map((mode) => {
            const active = composer.defaultMode === mode;
            return (
              <Pressable
                key={mode}
                onPress={() =>
                  void persistComposerPreference("defaultMode", mode)
                }
                className={`rounded-[16px] border px-3 py-2 ${optionChipClass(active)}`}
              >
                <Text
                  className={`text-[12px] font-semibold capitalize ${optionChipTextClass(active)}`}
                >
                  {mode}
                </Text>
                <Text className="mt-1 text-[10px] text-soft">Default mode</Text>
              </Pressable>
            );
          })}
          {[
            ["autoFollowTranscript", "Auto-follow transcript"],
            ["slashSuggestions", "Slash suggestions"],
          ].map(([key, label]) => {
            const active = composer[key as keyof typeof composer] as boolean;
            return (
              <Pressable
                key={key}
                onPress={() =>
                  void persistComposerPreference(
                    key as keyof typeof composer,
                    !active,
                  )
                }
                className={`rounded-[16px] border px-3 py-2 ${optionChipClass(active)}`}
              >
                <Text
                  className={`text-[12px] font-semibold ${optionChipTextClass(active)}`}
                >
                  {label}
                </Text>
                <Text className="mt-1 text-[10px] text-soft">
                  {active ? "On" : "Off"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Prompt presets"
        title="Reusable mobile prompts"
        description="Create local presets that behave like lightweight commands in the mobile palette and draft workflows."
      >
        <View className="gap-3">
          <TextField
            label="Preset title"
            value={presetTitle}
            onChangeText={setPresetTitle}
            placeholder="Review current work"
          />
          <TextField
            label="Preset prompt"
            value={presetPrompt}
            onChangeText={setPresetPrompt}
            placeholder="Review the current diff, identify risks, and propose next steps."
            multiline
          />
          <View className="flex-row gap-2">
            {(["code", "plan"] as const).map((mode) => {
              const active = presetMode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => setPresetMode(mode)}
                  className={`min-w-0 flex-1 rounded-[18px] border p-3 ${optionChipClass(active)}`}
                >
                  <Text
                    className={`text-sm font-semibold capitalize ${optionChipTextClass(active)}`}
                  >
                    {mode}
                  </Text>
                  <Text className="mt-1 text-xs leading-5 text-soft">
                    Insert as reusable {mode} preset
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <ActionButton
            label="Save preset"
            loading={saving}
            onPress={() => void addPreset()}
          />
          <View className="gap-3">
            {promptPresets.map((preset) => (
              <View
                key={preset.id}
                className="rounded-[8px] border border-border bg-background/60 p-4"
              >
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text className="text-base font-semibold text-ink">
                    {preset.title}
                  </Text>
                  <InfoChip label={preset.mode} tone="accent" />
                </View>
                <Text className="mt-2 text-sm leading-6 text-soft">
                  {preset.prompt}
                </Text>
                <View className="mt-3">
                  <ActionButton
                    label="Remove preset"
                    variant="secondary"
                    disabled={saving}
                    onPress={() => void removePreset(preset.id)}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Host commands"
        title="Add slash commands to the host"
        description="Custom commands become available in the mobile command palette and slash autocomplete for every session on this host."
      >
        {loading ? (
          <View className="items-center rounded-[8px] border border-border bg-background/60 px-4 py-5">
            <Text className="text-sm text-soft">
              Loading host command catalog…
            </Text>
          </View>
        ) : (
          <View className="gap-3">
            <TextField
              label="Command name"
              value={commandName}
              onChangeText={setCommandName}
              autoCapitalize="none"
              placeholder="deploy-preview"
            />
            <TextField
              label="Description"
              value={commandDescription}
              onChangeText={setCommandDescription}
              placeholder="Prepare a deployment preview checklist"
            />
            <TextField
              label="Template"
              value={commandTemplate}
              onChangeText={setCommandTemplate}
              multiline
              placeholder="Review the current branch and prepare it for deployment preview."
            />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <TextField
                  label="Agent (optional)"
                  value={commandAgent}
                  onChangeText={setCommandAgent}
                  autoCapitalize="none"
                  placeholder="reviewer"
                />
              </View>
              <View className="flex-1">
                <TextField
                  label="Model (optional)"
                  value={commandModel}
                  onChangeText={setCommandModel}
                  autoCapitalize="none"
                  placeholder="openai/gpt-4.1-mini"
                />
              </View>
            </View>
            <Pressable
              onPress={() => setCommandSubtask((value) => !value)}
              className={`rounded-[16px] border px-3 py-2 ${optionChipClass(commandSubtask)}`}
            >
              <Text
                className={`text-[12px] font-semibold ${optionChipTextClass(commandSubtask)}`}
              >
                Run as subtask
              </Text>
              <Text className="mt-1 text-[10px] text-soft">
                Use background/subtask execution semantics when supported.
              </Text>
            </Pressable>
            <ActionButton
              label="Save host command"
              loading={saving}
              onPress={() => void addCommand()}
            />

            <View className="gap-3">
              {commandEntries.length ? (
                commandEntries.map(([name, command]) => (
                  <View
                    key={name}
                    className="rounded-[8px] border border-border bg-background/60 p-4"
                  >
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-base font-semibold text-ink">
                        /{name}
                      </Text>
                      {command.subtask ? (
                        <InfoChip label="Task" tone="accent" />
                      ) : null}
                      {command.agent ? (
                        <InfoChip label={`Agent ${command.agent}`} />
                      ) : null}
                    </View>
                    {command.description ? (
                      <Text className="mt-2 text-sm leading-5 text-soft">
                        {command.description}
                      </Text>
                    ) : null}
                    <Text
                      selectable
                      className="mt-2 text-sm leading-6 text-soft"
                    >
                      {command.template}
                    </Text>
                    <View className="mt-3">
                      <ActionButton
                        label="Remove host command"
                        variant="secondary"
                        disabled={saving}
                        onPress={() => void removeCommand(name)}
                      />
                    </View>
                  </View>
                ))
              ) : (
                <View className="rounded-[8px] border border-border bg-background/60 p-4">
                  <Text className="text-sm leading-6 text-soft">
                    No custom host commands yet. Add one above to extend the
                    mobile palette.
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Resolved catalog"
        title="What mobile can already use"
        description="This is the current host command inventory after built-ins, project commands, and other sources are resolved."
      >
        <View className="gap-3">
          {catalog.map((command) => (
            <View
              key={command.name}
              className="rounded-[20px] border border-border bg-background/60 px-4 py-3.5"
            >
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-sm font-semibold text-ink">
                  /{command.name}
                </Text>
                {command.badge ? (
                  <InfoChip label={command.badge} tone="accent" />
                ) : null}
              </View>
              {command.description ? (
                <Text className="mt-1.5 text-xs leading-5 text-soft">
                  {command.description}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </SurfaceCard>
    </ScrollView>
  );
}
