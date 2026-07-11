import type { RefObject } from "react"
import { useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { Brain, Check } from "lucide-react-native"
import { ActionSheet, type ActionSheetRef } from "@/components/BottomSheet"
import { TextField } from "@/components/ui/TextField"
import { formatVariantLabel, type MobileModelOption } from "@/lib/model-catalog"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type Props = {
  sheetRef: RefObject<ActionSheetRef | null>
  models: MobileModelOption[]
  activeModelKey: string
  activeVariant?: string
  onSelect(modelKey: string, variant?: string): void
}

function VariantChip(props: {
  label: string
  active: boolean
  onPress(): void
}) {
  const { palette } = useAppTheme()
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: props.active }}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 7,
        opacity: pressed ? 0.72 : 1,
        backgroundColor: props.active ? hexToRgba(palette.accentLight, 0.16) : hexToRgba(palette.ink, 0.06),
        borderColor: props.active ? hexToRgba(palette.accentLight, 0.32) : hexToRgba(palette.ink, 0.12),
      })}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: props.active ? "700" : "600",
          color: props.active ? palette.accentLight : palette.soft,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  )
}

export function ModelPickerSheet({
  sheetRef,
  models,
  activeModelKey,
  activeVariant,
  onSelect,
}: Props) {
  const { palette } = useAppTheme()
  const [query, setQuery] = useState("")
  const [draftModelKey, setDraftModelKey] = useState(activeModelKey)
  const [draftVariant, setDraftVariant] = useState<string | undefined>(activeVariant)

  useEffect(() => {
    setDraftModelKey(activeModelKey)
    setDraftVariant(activeVariant)
  }, [activeModelKey, activeVariant])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return models
    return models.filter(
      (model) =>
        model.title.toLowerCase().includes(term) ||
        model.shortName.toLowerCase().includes(term) ||
        model.providerID.toLowerCase().includes(term),
    )
  }, [models, query])

  const selected = useMemo(
    () => models.find((model) => model.id === draftModelKey) ?? models.find((model) => model.id === activeModelKey),
    [activeModelKey, draftModelKey, models],
  )

  const applySelection = (modelKey: string, variant?: string) => {
    void triggerHaptic("selection")
    onSelect(modelKey, variant)
    sheetRef.current?.dismiss()
  }

  return (
    <ActionSheet ref={sheetRef} snapPoints={["82%"]}>
      <View className="border-b border-border px-5 pb-4">
        <Text className="text-[12px] font-medium text-muted">Model & thinking</Text>
        <Text className="mt-1.5 text-lg font-bold leading-6 tracking-tight text-ink" numberOfLines={2}>
          {selected?.title ?? "Choose a model"}
        </Text>
        <Text className="mt-1 text-[12px] leading-4 text-muted">
          Pick the model for this session and an optional thinking effort level, like the CLI variant picker.
        </Text>
      </View>

      <View className="px-5 pt-3">
        <TextField value={query} onChangeText={setQuery} placeholder="Search models" autoCapitalize="none" />
      </View>

      {selected && selected.variants.length > 0 ? (
        <View className="px-5 pt-4">
          <View className="mb-2 flex-row items-center gap-2">
            <Brain size={14} color={palette.accentLight} strokeWidth={2.2} />
            <Text className="text-[12px] font-semibold text-ink">Thinking effort</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          >
            <VariantChip
              label="Default"
              active={!draftVariant}
              onPress={() => {
                setDraftVariant(undefined)
                applySelection(selected.id, undefined)
              }}
            />
            {selected.variants.map((variant) => (
              <VariantChip
                key={variant}
                label={formatVariantLabel(variant)}
                active={draftVariant === variant}
                onPress={() => {
                  setDraftVariant(variant)
                  applySelection(selected.id, variant)
                }}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.map((model, index) => {
          const active = model.id === activeModelKey
          return (
            <Pressable
              key={model.id}
              onPress={() => {
                setDraftModelKey(model.id)
                setDraftVariant(undefined)
                if (model.variants.length === 0) applySelection(model.id, undefined)
                else void triggerHaptic("selection")
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 58,
                paddingVertical: 10,
                opacity: pressed ? 0.72 : 1,
                borderBottomWidth: index < filtered.length - 1 ? 1 : 0,
                borderBottomColor: hexToRgba(palette.ink, 0.08),
              })}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: active ? hexToRgba(palette.accentLight, 0.14) : hexToRgba(palette.ink, 0.06),
                  borderWidth: 1,
                  borderColor: active ? hexToRgba(palette.accentLight, 0.24) : hexToRgba(palette.ink, 0.1),
                }}
              >
                <Brain size={15} color={active ? palette.accentLight : palette.muted} strokeWidth={2.1} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-[13.5px] font-semibold text-ink" numberOfLines={1}>
                  {model.title}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {model.badge ? (
                    <Text className="text-[10px] font-semibold text-muted">{model.badge}</Text>
                  ) : null}
                  {model.variants.length > 0 ? (
                    <Text className="text-[10px] font-semibold text-muted">
                      {model.variants.length} thinking levels
                    </Text>
                  ) : null}
                </View>
              </View>
              {active ? <Check size={16} color={palette.accentLight} strokeWidth={2.4} /> : null}
            </Pressable>
          )
        })}
        {filtered.length === 0 ? (
          <Text className="py-8 text-center text-sm text-muted">No models match your search.</Text>
        ) : null}
      </ScrollView>
    </ActionSheet>
  )
}
