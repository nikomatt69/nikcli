# Plan: Elevate Mobile Component Micro-Details

## Context
The mobile app has 36 well-structured components with glass morphism, dark mode, and haptic feedback. The goal is to apply React Native best practices (from the loaded skill) to polish micro-details: fix performance anti-patterns, align tokens, add missing press states, and improve animation quality — without adding new libraries or creating new files.

---

## Issues Found & Fixes (Prioritized)

### 1. `components/chat/TypingIndicator.tsx` — CRITICAL perf fix
**Problem:** `setInterval` + `setState` at 200ms = 5 JS re-renders/sec. Also, inline `transform` style objects on animated views can't run on native thread.

**Fix:**
- Remove `dotIndex` state + `setInterval`
- Add 3 `Animated.Value` refs (one per dot)
- Use `Animated.loop(Animated.sequence([Animated.timing → toValue:1, Animated.timing → toValue:0, Animated.delay]))` with staggered delays (0ms, 150ms, 300ms)
- Set `useNativeDriver: true` on all animations
- Each dot renders `<Animated.View>` with `opacity` and `transform: [{ translateY }]` driven by its `Animated.Value` (bounce up effect)
- Cleanup: `anim.stop()` in `useEffect` return

### 2. `components/chat/ChatBubble.tsx` — Token alignment + 3 bug fixes

**a) Use `chatTokens` from `lib/theme.ts`**
Both `ChatBubble` and `VoiceMessageBubble` re-declare their own color objects (`chat = isDark ? {...} : {...}`) duplicating what's already in `chatTokens`. Import `chatTokens` from theme and use those. Export a `useChatTheme()` hook in theme.ts that returns `chatTokens[scheme]`.

**b) VoiceMessageBubble waveform — memoize `Math.random()`**
```ts
// Bug: new random array every render
const waveform = message.voiceWaveform || Array.from({ length: 30 }, () => 0.3 + Math.random() * 0.7)
```
Fix: `const waveform = useMemo(() => message.voiceWaveform ?? Array.from({ length: 30 }, () => 0.3 + Math.random() * 0.7), [message.voiceWaveform])`

**c) "Copied!" toast — broken absolute centering in RN**
`className="absolute -top-8 left-1/2 -translate-x-1/2"` — NativeWind translate doesn't work like CSS `translateX(-50%)` for centering in RN. Fix: remove the `View` wrapper around `ChatBubble` and render the toast as a sibling with `alignSelf: 'center'` inside a parent that uses `alignItems: isOwn ? 'flex-end' : 'flex-start'` (already the case). Change to `style={{ position: 'absolute', top: -32, alignSelf: 'center' }}`.

**d) Status icon: "sending" maps to `AlertCircle` (same as "failed")**
Fix: import `Clock` from lucide-react-native and map `sending → Clock`.

**e) Grouped bubble border radii**
The `grouped` prop is used for margin but not bubble shape. In iMessage style, when grouped, the connecting corner should be less rounded (4px instead of 22px):
- `isOwn && grouped`: `borderTopRightRadius: 4` (connecting to previous own bubble above)
- `!isOwn && grouped`: `borderTopLeftRadius: 4`

### 3. `components/layout/AppHeader.tsx` — Missing press state on Menu button

The Menu `Pressable` uses a static style object — zero press feedback:
```ts
<Pressable onPress={openDrawer} style={{ ... }}>
```
Fix: change `style={...}` to `style={({ pressed }) => ({ ...staticStyles, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.93 : 1 }] })}`.

### 4. `components/layout/AppTabBar.tsx` — Touch target & layout polish

**a)** Each tab `Pressable` has no `hitSlop` — minimum 44×44px touch target per HIG. The current tab area is ~34px tall. Add `hitSlop={6}` to each tab.

**b)** The inner icon container is `width: 82` hardcoded. On narrow screens this can overflow. Change to `flex: 1` with `maxWidth: 88`.

### 5. `components/session/SessionComposer.tsx` — Style object recreation

The `chromeBtn` const is defined inside the render function — recreated on every render:
```ts
const chromeBtn = { borderRadius: 999, borderWidth: 1, ... } as const
```
Fix: move `chromeBtn` outside the component as a module-level constant (it references no component state). It only depends on `isDark` which IS dynamic, so split it: extract the static parts into `StyleSheet.create` and merge the dynamic `borderColor`/`backgroundColor` per-use.

Actually simpler: keep the pattern but wrap with `useMemo(() => ({ ... }), [isDark])` so it only recreates on theme change.

**b)** The mode toggle button (`Plan`/`Code`) switches instantly. Add `Animated.timing` to smoothly transition the background indicator:
- Add `modeAnim = useRef(new Animated.Value(mode === 'code' ? 1 : 0)).current`
- When `setMode` is called, animate to 0 or 1 (duration 180ms, easing ease-out)
- Use `modeAnim.interpolate` for `backgroundColor` and `borderColor` on the mode pill

### 6. `components/MessageBubble.tsx` — Chevron rotation animation for reasoning toggle

Currently the expand/collapse uses two different icons (`ChevronDown`/`ChevronRight`). A smooth rotation animation would be more polished:
- Add `reasoningRotation = useRef(new Animated.Value(showReasoning ? 1 : 0)).current`
- Inside `toggleReasoning()`, add `Animated.timing(reasoningRotation, { toValue: showReasoning ? 0 : 1, duration: 200, useNativeDriver: true }).start()` (before the `setShowReasoning` flip, since state flip happens async)
- Render a single `<ChevronRight>` wrapped in `<Animated.View style={{ transform: [{ rotate: reasoningRotation.interpolate({ inputRange: [0,1], outputRange: ['0deg','90deg'] }) }] }}>` — replaces the conditional icon swap

---

## Files to Modify

| File | Changes |
|------|---------|
| `components/chat/TypingIndicator.tsx` | Replace interval with Animated.loop per dot |
| `components/chat/ChatBubble.tsx` | chatTokens alignment, waveform memo, toast fix, status icons, grouped radii |
| `lib/theme.ts` | Add `useChatTheme()` hook |
| `components/layout/AppHeader.tsx` | Add press state to Menu button |
| `components/layout/AppTabBar.tsx` | Add hitSlop, fix hardcoded width |
| `components/session/SessionComposer.tsx` | useMemo for chromeBtn, mode toggle animation |
| `components/MessageBubble.tsx` | Animated chevron rotation for reasoning toggle |

**No new files. No new packages.**

---

## Reusable Utilities
- `triggerHaptic` from `lib/haptics.ts` — already used in all touch handlers ✓
- `useAppTheme` from `lib/theme.ts` — source of truth for palette ✓
- `chatTokens` from `lib/theme.ts` — to be wired into ChatBubble replacing duplicate inline color objects

---

## Verification
- Run app in Expo Go / iOS simulator
- Open a session with streaming messages → verify TypingIndicator dots bounce smoothly without jank
- Switch tabs → verify indicator dot animates without visual glitch
- Tap menu button → verify scale/opacity press state
- Long-press a chat bubble in a grouped conversation → verify correct border radii
- Type "/" in composer → verify slash autocomplete renders
- Toggle Plan/Code mode → verify smooth animated transition
- Expand reasoning block → verify chevron rotates instead of snapping
