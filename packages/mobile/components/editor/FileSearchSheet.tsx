import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Search, X } from "lucide-react-native"
import { useServer } from "@/lib/server-provider"
import { useAppTheme } from "@/lib/theme"
import type { RipgrepMatch } from "@/lib/types"

type SearchResult = {
  file: string
  line: number
  text: string
  submatches: Array<{ start: number; end: number }>
}

function parseResults(matches: RipgrepMatch[]): SearchResult[] {
  const results: SearchResult[] = []
  let currentFile = ""

  for (const m of matches) {
    if (m.type === "begin" && m.data.path?.text) {
      currentFile = m.data.path.text
    } else if (m.type === "match" && m.data.lines?.text && m.data.line_number != null) {
      results.push({
        file: currentFile,
        line: m.data.line_number,
        text: m.data.lines.text.replace(/\n$/, ""),
        submatches: (m.data.submatches ?? []).map((s) => ({ start: s.start, end: s.end })),
      })
    }
  }
  return results
}

export function FileSearchSheet(props: {
  visible: boolean
  onClose(): void
  onSelect(file: string, line: number): void
}) {
  const { palette, isDark } = useAppTheme()
  const { client } = useServer()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<TextInput>(null)

  useEffect(() => {
    if (props.visible) {
      setTimeout(() => inputRef.current?.focus(), 200)
    } else {
      setQuery("")
      setResults([])
    }
  }, [props.visible])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim() || !client) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true)
        const raw = await client.searchText(query.trim())
        setResults(parseResults(raw))
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [query, client])

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        <View
          style={{
            maxHeight: "75%",
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.78)",
          }}
        >
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(14,14,14,0.97)" : "rgba(255,255,255,0.98)" }]}
            pointerEvents="none"
          />

          {/* Search input */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 12,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
            }}
          >
            <Search size={16} color={palette.muted} strokeWidth={2} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search in files…"
              placeholderTextColor={palette.muted}
              style={{
                flex: 1,
                fontSize: 15,
                color: palette.ink,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {loading ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : query ? (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <X size={15} color={palette.muted} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>

          {/* Results */}
          <FlatList
            data={results}
            keyExtractor={(item, i) => `${item.file}:${item.line}:${i}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            ListEmptyComponent={
              !loading && query.trim() ? (
                <View style={{ alignItems: "center", padding: 32 }}>
                  <Text style={{ color: palette.muted, fontSize: 14 }}>No results</Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  props.onSelect(item.file, item.line)
                  props.onClose()
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: pressed
                    ? isDark
                      ? "rgba(255,255,255,0.05)"
                      : "rgba(14,165,233,0.05)"
                    : "transparent",
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                })}
              >
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 11, color: palette.accentLight, fontWeight: "500", marginBottom: 3 }}
                >
                  {item.file.split("/").slice(-2).join("/")}
                  <Text style={{ color: palette.muted }}> :{item.line}</Text>
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    color: palette.soft,
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  }}
                >
                  {item.text.trimStart()}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
