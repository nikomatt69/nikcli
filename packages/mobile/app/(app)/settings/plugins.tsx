import { useCallback, useMemo, useState } from "react"
import { ScrollView, Text, View } from "react-native"
import { Stack, useFocusEffect } from "expo-router"
import { ActionButton } from "@/components/ui/ActionButton"
import { ErrorBanner } from "@/components/ui/ErrorBanner"
import { InfoChip } from "@/components/ui/InfoChip"
import { SurfaceCard } from "@/components/ui/SurfaceCard"
import { TextField } from "@/components/ui/TextField"
import { useServer } from "@/lib/server-provider"
import { type PluginInfo } from "@/lib/types"

export default function PluginsSettingsScreen() {
  const { client } = useServer()
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [pluginSpec, setPluginSpec] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client) return
    try {
      setLoading(true)
      setPlugins(await client.listPlugins())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function addPlugin() {
    if (!client) return
    const spec = pluginSpec.trim()
    if (!spec) {
      setMessage("Plugin specifier is required")
      return
    }

    try {
      setSaving(true)
      setMessage(null)
      await client.addPlugin(spec)
      setPluginSpec("")
      await load()
      setMessage(`Plugin ${spec} added successfully`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function removePlugin(name: string) {
    if (!client) return

    try {
      setSaving(true)
      setMessage(null)
      await client.removePlugin(name)
      await load()
      setMessage(`Plugin ${name} removed`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const builtinPlugins = useMemo(() => plugins.filter((p) => p.builtin || p.internal), [plugins])
  const userPlugins = useMemo(() => plugins.filter((p) => !p.builtin && !p.internal), [plugins])

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 36 }}
    >
      <Stack.Screen options={{ title: "Plugins" }} />

      <SurfaceCard
        eyebrow="Plugin registry"
        title="Extensibility framework"
        description="Add npm-based plugins to extend nikcli capabilities including hooks, tools, auth methods, and TUI components."
      >
        <View className="flex-row flex-wrap gap-2">
          <InfoChip label={`${plugins.length} total`} tone={plugins.length ? "accent" : "neutral"} />
          <InfoChip label={`${builtinPlugins.length} built-in`} />
          <InfoChip label={`${userPlugins.length} user`} />
        </View>
      </SurfaceCard>

      {message ? <ErrorBanner message={message} /> : null}

      <SurfaceCard
        eyebrow="Add plugin"
        title="Install from npm"
        description="Install a plugin by its npm package name. Supports version specifiers like @scope/plugin@1.0.0."
      >
        <View className="gap-3">
          <TextField
            label="Plugin specifier"
            value={pluginSpec}
            onChangeText={setPluginSpec}
            autoCapitalize="none"
            placeholder="@scope/plugin@version"
          />
          <ActionButton label="Add plugin" loading={saving} onPress={() => void addPlugin()} />
        </View>
      </SurfaceCard>

      <SurfaceCard
        eyebrow="Built-in plugins"
        title="Core system plugins"
        description="These plugins are bundled with nikcli and provide core functionality."
      >
        {loading ? (
          <View className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
            <Text className="text-sm leading-6 text-soft">Loading plugins…</Text>
          </View>
        ) : builtinPlugins.length ? (
          <View className="gap-3">
            {builtinPlugins.map((plugin) => (
              <View key={plugin.name} className="rounded-[24px] border border-border bg-background/60 px-4 py-4">
                <View className="flex-row flex-wrap gap-2">
                  <Text className="text-base font-semibold text-ink">{plugin.name}</Text>
                  {plugin.builtin ? <InfoChip label="Built-in" tone="accent" /> : null}
                  {plugin.internal ? <InfoChip label="Internal" tone="warn" /> : null}
                </View>
                <Text selectable className="mt-2 text-xs leading-5 text-soft">
                  {plugin.spec}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
            <Text className="text-sm leading-6 text-soft">No built-in plugins configured.</Text>
          </View>
        )}
      </SurfaceCard>

      <SurfaceCard
        eyebrow="User plugins"
        title="Installed plugins"
        description="User-installed plugins that extend nikcli functionality. These can be removed."
      >
        {loading ? (
          <View className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
            <Text className="text-sm leading-6 text-soft">Loading plugins…</Text>
          </View>
        ) : userPlugins.length ? (
          <View className="gap-3">
            {userPlugins.map((plugin) => (
              <View key={plugin.name} className="rounded-[24px] border border-border bg-background/60 px-4 py-4">
                <View className="flex-row flex-wrap gap-2">
                  <Text className="text-base font-semibold text-ink">{plugin.name}</Text>
                  {plugin.options ? <InfoChip label="Has options" tone="accent" /> : null}
                </View>
                <Text selectable className="mt-2 text-xs leading-5 text-soft">
                  {plugin.spec}
                </Text>
                {plugin.options ? (
                  <Text selectable className="mt-2 text-xs leading-5 text-soft">
                    Options: {JSON.stringify(plugin.options)}
                  </Text>
                ) : null}
                <View className="mt-3">
                  <ActionButton
                    label="Remove"
                    variant="secondary"
                    loading={saving}
                    onPress={() => void removePlugin(plugin.name)}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className="rounded-[22px] border border-border bg-background/60 px-4 py-4">
            <Text className="text-sm leading-6 text-soft">
              No user plugins installed. Add one above to get started.
            </Text>
          </View>
        )}
      </SurfaceCard>
    </ScrollView>
  )
}
