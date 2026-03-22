# Mobile Agent Guidelines

## Project Structure

```
packages/mobile/
├── app/              # Expo Router screens (file-based routing)
│   ├── (app)/       # App group routes
│   │   ├── repos/   # Repository management screens
│   │   ├── sessions/# Session screens
│   │   └── settings/# Settings screens
│   ├── _layout.tsx  # Root layout
│   └── index.tsx    # Main entry
├── components/       # React Native components
│   ├── layout/      # Layout components (header, tabbar, drawer)
│   ├── session/     # Session-related components (sheets, composer)
│   ├── settings/    # Settings components
│   └── ui/          # Reusable UI primitives
├── hooks/           # Custom React hooks
├── lib/             # Core libraries and utilities
│   ├── client.ts    # MobileClient API wrapper
│   ├── highlight.ts # Code syntax highlighting
│   ├── store.ts     # Zustand state management
│   ├── storage.ts   # Secure storage utilities
│   ├── theme.ts     # Theme configuration (light/dark palettes)
│   └── types.ts     # TypeScript type definitions
├── ios/             # iOS native code (Xcode project)
└── android/         # Android native code (Gradle)
```

## Build/Test Commands

- **Start**: `bun start` (or `expo start`)
- **iOS**: `bun ios` (or `expo run:ios`)
- **Android**: `bun android` (or `expo run:android`)
- **Web**: `bun web` (or `expo start --web`)
- **Typecheck**: `bun tsc --noEmit`

## Tech Stack

- **Framework**: Expo SDK 52 with React Native 0.76
- **Routing**: expo-router (file-based routing)
- **Styling**: NativeWind (Tailwind CSS for RN) + native StyleSheet
- **State**: Zustand for global state, React hooks for local
- **Navigation**: @react-navigation/native
- **Icons**: lucide-react-native
- **Gestures**: react-native-gesture-handler
- **SSE**: react-native-sse for real-time streaming

## Key Patterns

### API Client

Use `MobileClient` from `@/lib/client` for all server communication:

```typescript
import { getMobileClient } from "@/lib/client"

const client = await getMobileClient()
if (client) {
  const sessions = await client.listSessions()
}
```

### SSE Streaming

Use `useSessionStream` hook for real-time updates:

```typescript
import { useSessionStream, type ConnectionState } from "@/hooks/use-session-stream"

const { connectionState, reconnect } = useSessionStream({
  config: server.config,
  sessionID: session.id,
  enabled: isFocused,
  onEvent: handleEvent,
  onError: showError,
})

// connectionState: "connecting" | "connected" | "reconnecting" | "disconnected"
```

### State Management

Global state via Zustand (`@/lib/store`):

```typescript
import { useUIStore } from "@/lib/store"

const { themeMode, setThemeMode } = useUIStore()
```

### Theming

Use `useAppTheme()` for consistent styling:

```typescript
import { useAppTheme } from "@/lib/theme"

const { palette, colorScheme, isDark } = useAppTheme()
// palette contains all color tokens (ink, soft, accent, danger, etc.)
```

### Code Highlighting

Use `useHighlightedCode` hook for memoized syntax highlighting:

```typescript
import { useHighlightedCode } from "@/hooks/use-highlight"

const segments = useHighlightedCode(code)
// Returns: Array<{ text: string; color: string }>
```

## Code Style

- **Imports**: Use `@/` path alias for internal modules
- **Styling**: Prefer Tailwind classes via NativeWind; fallback to StyleSheet for animations
- **Types**: All API types in `@/lib/types`; extend sparingly
- **Components**: Functional components with hooks; no class components
- **Error Handling**: Use error boundaries for component failures

## Mobile-Specific Considerations

### Network Resilience
- SSE connections must handle reconnection with exponential backoff (see `useSessionStream`)
- Use `client.ping()` or `client.health()` to verify server connectivity
- Show user feedback for all network states

### Performance
- Memoize expensive computations with `useMemo`
- Use `useCallback` for stable function references in effects
- Virtualize long lists with FlatList
- Lazy load images and heavy components

### Platform Differences
- Test on both iOS and Android
- Handle safe areas with `react-native-safe-area-context`
- Use `Platform.select()` for platform-specific code

## Common Tasks

### Adding a New API Endpoint

1. Add method to `MobileClient` in `lib/client.ts`
2. Add corresponding types in `lib/types.ts`
3. Use the method in components via `getMobileClient()`

### Adding a New Screen

1. Create file in `app/` with expo-router conventions
2. Add to navigation in `components/layout/navigation.config.ts`
3. Use `Stack.Screen` or `Tabs.Screen` as appropriate

### Adding a New Theme Token

1. Add to both `palettes.light` and `palettes.dark` in `lib/theme.ts`
2. Use via `useAppTheme().palette`

## Debugging

- **React Native Debugger**: Connect to Metro bundler for debugging
- **Network**: Use Flipper (Android) or Charles Proxy (iOS)
- **Logs**: Check console output in development build
- **SSE**: Verify `/mobile/session/:id/stream` endpoint responds correctly
