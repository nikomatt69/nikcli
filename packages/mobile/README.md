# Nikcli Mobile

Mobile app for connecting to Nikcli servers and receiving SSE events in real-time.

## Features

- Real-time SSE event streaming
- Session management and monitoring
- Event log with filtering
- Offline support with queue
- Cross-platform (iOS & Android)

## Getting Started

### Prerequisites

- Node.js 18+
- bun or npm
- Expo CLI (`npm i -g expo-cli`)
- iOS Simulator or Android Studio (for native builds)

### Installation

```bash
cd packages/mobile
bun install
```

### Development

```bash
bun dev          # Start Expo dev server
bun ios          # Run on iOS simulator
bun android      # Run on Android emulator
```

### Build

```bash
bun build:ios        # Build for iOS
bun build:android    # Build for Android
```

## Architecture

```
packages/mobile/
├── app/                   # Expo Router screens
│   ├── (auth)/           # Authentication screens
│   ├── (tabs)/           # Main app tabs
│   └── session/          # Session detail
├── src/
│   ├── components/       # React components
│   │   ├── ui/          # Base UI components
│   │   ├── sse/         # SSE-specific components
│   │   └── session/     # Session components
│   ├── hooks/           # Custom React hooks
│   ├── services/        # Core services
│   ├── stores/          # Zustand stores
│   ├── providers/       # Context providers
│   ├── types/           # TypeScript types
│   └── utils/           # Utilities
└── assets/              # Fonts, images
```

## Dependencies

- React Native 0.76
- Expo SDK 52
- Zustand (state)
- TanStack Query (data fetching)
- React Native Paper (UI)
- Moti (animations)
