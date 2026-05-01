/**
 * Shared default values for app preferences.
 * These are used by both storage.ts (persistence) and store.ts (runtime state).
 */

import type {
  AppPreferences,
  ComposerPreferences,
  GesturePreferences,
  HapticPreferences,
  NotificationPreferences,
  PromptPreset,
  SettingsSectionID,
} from "./types"

export const DEFAULT_SETTINGS_SECTIONS: Record<SettingsSectionID, boolean> = {
  profile: true,
  interaction: true,
  commands: true,
  memories: true,
  connection: true,
  execution: true,
  providers: true,
  github: true,
  mcp: true,
  skills: true,
  advanced: true,
  connectors: true,
  agents: true,
  tokens: true,
  routines: true,
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
  sessionReady: true,
  permissions: true,
  failures: true,
}

export const DEFAULT_HAPTIC_PREFERENCES: HapticPreferences = {
  enabled: true,
  send: true,
  commands: true,
  permissions: true,
  errors: true,
}

export const DEFAULT_GESTURE_PREFERENCES: GesturePreferences = {
  bubbleSwipeActions: true,
  bubbleLongPressActions: true,
}

export const DEFAULT_COMPOSER_PREFERENCES: ComposerPreferences = {
  defaultMode: "code",
  autoFollowTranscript: true,
  slashSuggestions: true,
}

export const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "preset-review",
    title: "Review current work",
    prompt: "Review the current changes, call out risks, and propose the smallest safe next steps.",
    mode: "plan",
  },
  {
    id: "preset-fix",
    title: "Fix latest error",
    prompt: "Investigate the latest failure, explain the root cause, and apply the smallest correct fix.",
    mode: "code",
  },
  {
    id: "preset-publish",
    title: "Prepare publish",
    prompt: "Check the diff, summarize the work, and get this session ready to publish safely.",
    mode: "plan",
  },
]

export function defaultPreferences(): AppPreferences {
  return {
    themeMode: "system",
    visibleSettingsSections: DEFAULT_SETTINGS_SECTIONS,
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    haptics: DEFAULT_HAPTIC_PREFERENCES,
    gestures: DEFAULT_GESTURE_PREFERENCES,
    composer: DEFAULT_COMPOSER_PREFERENCES,
    promptPresets: DEFAULT_PROMPT_PRESETS,
  }
}
