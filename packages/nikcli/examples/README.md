# Nikcli Visual Examples

This directory contains visual demonstrations of nikcli's capabilities.

## Examples

### 1. CLI Interface Demo (`cli-demo/`)

Interactive terminal UI showcasing nikcli's command-line interface with:

- Session management display
- Real-time AI response streaming
- File tree visualization
- Command palette

### 2. Web App Components (`web-components/`)

React components from the nikcli web app:

- Session viewer with syntax highlighting
- Settings panel with theme switcher
- Connection status indicators
- Terminal emulator

### 3. Mobile App UI (`mobile-ui/`)

Expo/React Native screens:

- Session list with swipe actions
- Chat interface with code blocks
- Settings and connection management
- Offline mode indicators

### 4. AI Tools Visualization (`ai-tools/`)

Visual representations of nikcli's AI tool system:

- Tool execution flow diagrams
- Context collection visualization
- RAG search result display
- Multi-agent orchestration

## Running Examples

```bash
# CLI Demo
bun run packages/nikcli/examples/cli-demo/demo.ts

# Web Components
cd packages/app && bun dev

# Mobile UI
cd packages/mobile && bun start
```
