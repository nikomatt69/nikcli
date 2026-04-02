# Nikcli Complete Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Quick Start](#quick-start)
3. [Project Structure](#project-structure)
4. [Core Concepts](#core-concepts)
5. [CLI Commands Reference](#cli-commands-reference)
6. [Configuration](#configuration)
7. [Plugin System](#plugin-system)
8. [Development](#development)
9. [Deployment](#deployment)
10. [SDK & API](#sdk--api)
11. [Testing](#testing)
12. [Contributing](#contributing)
13. [Troubleshooting](#troubleshooting)

---

## Introduction

Nikcli is an AI-powered development tool with a CLI and TUI interface. It uses AI models to assist with coding tasks, featuring:

- **TUI (Terminal User Interface)**: Interactive terminal interface with SolidJS + OpenTUI
- **CLI Mode**: Command-line execution for scripts and automation
- **Server Mode**: HTTP + SSE API for remote connections
- **Remote Attach**: Connect to remote servers via URL
- **Multi-Platform**: Desktop (Tauri), Mobile (Expo/Tauri), Web

### Key Features

- Agent-based architecture with customizable agents
- Tool system: bash, read, write, edit, glob, grep, web search
- MCP (Model Context Protocol) integration
- LSP (Language Server Protocol) support
- Plugin ecosystem for extensibility
- Slack integration
- RAG (Retrieval-Augmented Generation) capabilities

---

## Quick Start

### Installation

```bash
# From source
git clone https://github.com/nikomatt69/nikcli
cd nikcli
bun install

# Or use the install script
curl -fsSL https://nikcli.store/install | bash
```

### Running Nikcli

```bash
# Development mode (runs in packages/nikcli)
bun dev

# Run against a specific directory
bun dev /path/to/project

# Run in current directory
bun dev .
```

### Basic Commands

```bash
# Start TUI
nikcli

# Run a message directly
nikcli run "Hello, write a hello world function"

# Start server mode
nikcli serve

# Attach to remote server
nikcli attach https://your-server.com

# List agents
nikcli agent list

# Create new agent
nikcli agent create
```

---

## Project Structure

```
nikcli/
├── packages/
│   ├── nikcli/              # Core CLI/TUI application
│   │   ├── src/
│   │   │   ├── cli/         # CLI commands
│   │   │   ├── agent/       # Agent system
│   │   │   ├── server/      # HTTP/SSE server
│   │   │   ├── provider/    # LLM provider integration
│   │   │   ├── config/      # Configuration management
│   │   │   ├── auth/        # Authentication
│   │   │   ├── tool/        # Tool implementations
│   │   │   ├── plugin/      # Plugin system
│   │   │   ├── skill/       # Skills system
│   │   │   ├── mcp/         # MCP client
│   │   │   ├── lsp/         # LSP integration
│   │   │   ├── session/     # Session management
│   │   │   └── storage/     # Data persistence
│   │   └── script/          # Build scripts
│   │
│   ├── app/                 # Shared web UI (SolidJS)
│   │   ├── src/             # UI components
│   │   └── e2e/             # End-to-end tests
│   │
│   ├── desktop/             # Tauri desktop app
│   │   ├── src-tauri/       # Rust/Tauri code
│   │   └── src/             # Web UI
│   │
│   ├── mobile/              # Mobile app (Expo + Tauri)
│   │   ├── app/             # React Native code
│   │   ├── ios/             # iOS native code
│   │   └── android/         # Android native code
│   │
│   ├── web/                 # Marketing website (Astro)
│   │
│   ├── sdk/                 # JavaScript SDK
│   │   ├── js/              # JS SDK implementation
│   │   └── example/         # Usage examples
│   │
│   ├── plugin/              # Plugin system
│   │   └── plugins/         # Built-in plugins
│   │       ├── agent-memory/
│   │       ├── background/
│   │       ├── background-agents/
│   │       ├── context-analysis/
│   │       ├── direnv/
│   │       ├── dynamic-context-pruning/
│   │       ├── envsitter-guard/
│   │       ├── handoff/
│   │       ├── safety-net/
│   │       └── smart-title/
│   │
│   ├── slack/               # Slack bot integration
│   ├── console/             # Console application
│   ├── cloud/               # Cloudflare Workers
│   ├── enterprise/          # Enterprise features
│   ├── companion/           # Browser extension
│   ├── remote/              # Remote attach functionality
│   ├── ui/                  # UI component library
│   ├── util/                # Utilities
│   ├── function/            # Serverless functions
│   ├── containers/          # Docker containers
│   └── script/              # Build/release scripts
│
├── script/                   # CI/CD scripts
├── infra/                    # Infrastructure as code
├── themes/                   # UI themes
├── specs/                    # Technical specifications
└── github/                   # GitHub Actions
```

---

## Core Concepts

### Agents

Agents are AI assistants with specific capabilities and permissions. Nikcli ships with default agents:

| Agent | Mode | Description |
|-------|------|-------------|
| `build` | primary | Full permissions for building |
| `plan` | primary | Read-only for planning |
| `general` | subagent | General assistance |
| `explore` | subagent | Code exploration |
| `@fast-explore` | subagent | Quick exploration |
| `@planner` | subagent | Planning and analysis |
| `@code-reviewer` | subagent | Code review |
| `@debugger` | subagent | Debugging assistance |
| `@test-runner` | subagent | Testing support |
| `@refactor` | subagent | Refactoring assistance |

#### Agent Configuration (YAML frontmatter)

```yaml
---
description: "When to use this agent"
mode: primary  # primary, subagent, all
tools:
  bash: true
  read: true
  write: false
---
System prompt content here...
```

### Tools

Available tools for agents:

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `read` | Read file contents |
| `write` | Write files |
| `edit` | Edit files (search/replace) |
| `glob` | Find files by pattern |
| `grep` | Search file contents |
| `list` | List directory contents |
| `webfetch` | Fetch web content |
| `task` | Execute subtasks |
| `todowrite` | Create todo items |
| `todoread` | Read todo items |
| `generate_image` | Generate images |
| `speak` | Text-to-speech |

### Providers

Nikcli supports multiple LLM providers:

- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude)
- Google (Gemini)
- Azure OpenAI
- Local models (via OpenAI-compatible API)

Configuration in `nikcli.jsonc`:

```jsonc
{
  "provider": {
    "default": "openai/gpt-4",
    "models": {
      "openai/gpt-4": {
        "apiKey": "sk-..."
      }
    }
  }
}
```

### Sessions

Sessions maintain conversation history and context:

- Stored in `~/.config/nikcli/sessions/`
- Shareable via URLs
- Session IDs start with `ses_`
- Share IDs are 26-character alphanumeric strings

### Connectors

Connectors provide integrations with external services:

- OAuth providers
- API keys
- Webhooks

---

## CLI Commands Reference

### Core Commands

```bash
# Run a message
nikcli run [message..]
nikcli run "Write a hello world function"

# Interactive TUI
nikcli
nikcli tui

# Server mode (headless)
nikcli serve [--port <port>] [--hostname <host>]
nikcli serve --port 4096 --hostname 0.0.0.0

# Attach to remote server
nikcli attach <url>
nikcli attach https://server.nikcli.store
```

### Agent Management

```bash
# List all agents
nikcli agent list

# Create new agent
nikcli agent create [--path <path>] [--description <desc>] [--mode <mode>] [--tools <tools>] [--model <model>]

# Example
nikcli agent create --description "Code reviewer" --mode subagent --tools bash,read,glob
```

### Model Management

```bash
# List available models
nikcli models

# Set default model
nikcli models set <provider/model>
```

### Authentication

```bash
# Authenticate with providers
nikcli auth
nikcli auth openai
nikcli auth anthropic
```

### GitHub Integration

```bash
# Install GitHub App
nikcli github install

# Manage installations
nikcli github list
```

### Connectors

```bash
# Manage connectors
nikcli connectors list
nikcli connectors add <connector>
nikcli connectors remove <connector>
nikcli connectors auth <connector>
```

### Server Commands

```bash
# Remote control
nikcli remote status
nikcli remote start
nikcli remote-control

# Web UI
nikcli web
```

### Utility Commands

```bash
# Generate files
nikcli generate <type>
nikcli generate component

# Import/Export
nikcli import <file>
nikcli export [--format <format>]

# Statistics
nikcli stats

# Upgrade/Uninstall
nikcli upgrade
nikcli uninstall
```

---

## Configuration

### Config Resolution Order

Configs are loaded in order of precedence (highest wins):

1. **Remote**: `/.well-known/nikcli` (OAuth providers)
2. **Global**: `~/.config/nikcli/nikcli.jsonc`
3. **Environment**: `NIKCLI_CONFIG` or `NIKCLI_CONFIG_CONTENT`
4. **Project**: `nikcli.jsonc` / `nikcli.json` (discovered upward)

### Schema

Full schema available at: https://nikcli.store/config.json

### Example Configuration

```jsonc
{
  // Provider configuration
  "provider": {
    "default": "openai/gpt-4",
    "models": {
      "openai/gpt-4": {
        "apiKey": "sk-...",
        "maxTokens": 4096
      },
      "anthropic/claude-3-opus": {
        "apiKey": "sk-ant-..."
      }
    }
  },

  // Agent configuration
  "agent": {
    "system": [
      "path/to/custom/system-prompt.txt"
    ],
    "permission": "read"  // read, ask, write, none
  },

  // MCP servers
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/"]
      }
    }
  },

  // Custom agents
  "agents": {
    "my-agent": {
      "model": "openai/gpt-4",
      "permission": "write"
    }
  },

  // Theme
  "theme": "deltarune",  // or "undertale"

  // Editor
  "editor": {
    "command": "code",
    "args": ["--wait"]
  },

  // Terminal
  "terminal": {
    "command": "zsh"
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NIKCLI_CONFIG` | Path to config file |
| `NIKCLI_CONFIG_CONTENT` | Config content directly |
| `NIKCLI_SERVER_PASSWORD` | Server auth password |
| `NIKCLI_SERVER_USERNAME` | Server auth username |
| `NIKCLI_SERVER_PORT` | Server port |
| `NIKCLI_SERVER_HOSTNAME` | Server hostname |
| `NIKCLI_SERVER_TAILSCALE_AUTH` | Enable Tailscale auth |
| `NIKCLI_SERVER_SSH_HOST` | SSH server host |
| `NIKCLI_SERVER_SSH_PORT` | SSH server port |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |

---

## Plugin System

### Overview

Plugins extend Nikcli's functionality through the `@nikcli-ai/plugin` package.

### Available Plugins

| Plugin | Description |
|--------|-------------|
| `@nikcli-ai/plugin-agent-memory` | Persistent self-editable memory blocks |
| `@nikcli-ai/plugin-background` | Background task execution |
| `@nikcli-ai/plugin-background-agents` | Multi-agent background processing |
| `@nikcli-ai/plugin-context-analysis` | Context analysis |
| `@nikcli-ai/plugin-direnv` | Environment variable management |
| `@nikcli-ai/plugin-dynamic-context-pruning` | Smart context optimization |
| `@nikcli-ai/plugin-envsitter-guard` | Environment safety guard |
| `@nikcli-ai/plugin-handoff` | Agent handoff |
| `@nikcli-ai/plugin-safety-net` | Safety features |
| `@nikcli-ai/plugin-smart-title` | Smart conversation titling |

### Creating a Plugin

```typescript
// packages/plugin/plugins/my-plugin/index.ts
import type { Plugin } from "@nikcli-ai/plugin"

export interface MyPluginConfig {
  option1: string
}

export const myPlugin: Plugin<MyPluginConfig> = {
  name: "my-plugin",
  
  async setup(config) {
    // Plugin setup logic
    return {
      // Tools
      tools: {},
      
      // Lifecycle hooks
      onMessage: async (message) => {},
      onAgentStart: async (agent) => {},
      onAgentEnd: async (agent, result) => {},
      
      // Cleanup
      cleanup: async () => {}
    }
  }
}
```

### Plugin Configuration

In `nikcli.jsonc`:

```jsonc
{
  "plugins": {
    "my-plugin": {
      "option1": "value"
    }
  }
}
```

---

## Development

### Prerequisites

- Bun 1.3+
- Node.js 18+ (for some tools)
- Rust toolchain (for desktop/mobile builds)
- Git

### Setup

```bash
# Clone and install
git clone https://github.com/nikomatt69/nikcli
cd nikcli
bun install

# Run dev server
bun dev

# Or specify directory
bun dev /path/to/project
```

### Package-Specific Development

#### Core CLI (packages/nikcli)

```bash
# Run directly
cd packages/nikcli
bun run src/index.ts

# Build standalone executable
./packages/nikcli/script/build.ts --single

# Run built executable
./packages/nikcli/dist/nikcli-<platform>/bin/nikcli
```

#### Web App (packages/app)

```bash
bun run --cwd packages/app dev
# Opens at http://localhost:5173
```

#### Desktop App (packages/desktop)

```bash
# Web dev server only
bun run --cwd packages/desktop dev

# Full Tauri dev
bun run --cwd packages/desktop tauri dev

# Production build
bun run --cwd packages/desktop tauri build
```

#### Mobile App (packages/mobile)

```bash
# iOS simulator
bun run --cwd packages/mobile ios

# Android emulator
bun run --cwd packages/mobile android

# Expo development
cd packages/mobile
npx expo start
```

#### SDK (packages/sdk/js)

```bash
# Build SDK
./packages/sdk/js/script/build.ts

# Generate from API
./script/generate.ts
```

### Debugging

#### VSCode Setup

Use provided example configurations:

```bash
# Copy example configs
cp .vscode/settings.example.json .vscode/settings.json
cp .vscode/launch.example.json .vscode/launch.json
```

#### Debug Options

```bash
# Inspect mode
bun run --inspect=ws://localhost:6499/ dev

# Wait for debugger
bun run --inspect-wait=ws://localhost:6499/ dev

# Break on first line
bun run --inspect-brk=ws://localhost:6499/ dev
```

#### Debug Server Separately

```bash
# Terminal 1: Debug server
cd packages/nikcli
bun run --inspect=ws://localhost:6499/ src/index.ts serve --port 4096

# Terminal 2: Attach TUI
cd packages/nikcli
nikcli attach http://localhost:4096

# Or run TUI in debug mode
bun run --inspect=ws://localhost:6499/ --conditions=browser src/index.ts
```

### Building

```bash
# Type checking
bun turbo typecheck

# Build all packages
bun turbo build

# Build specific package
bun turbo build --filter=@nikcli-ai/app

# Build nikcli executable
./packages/nikcli/script/build.ts --single
```

---

## Deployment

### Server Deployment

#### Local Server

```bash
# Basic server
nikcli serve

# With authentication
export NIKCLI_SERVER_PASSWORD="secure-password"
export NIKCLI_SERVER_USERNAME="admin"
nikcli serve --port 4096

# Accessible externally
nikcli serve --port 4096 --hostname 0.0.0.0
```

#### Cloudflare Workers

```bash
cd packages/slack

# Deploy with custom domain
bunx wrangler deploy src/worker.ts --name nikcli-slack --routes 'slack.nikcli.store/*'
```

#### Railway

```bash
cd packages/slack
# Use Dockerfile.serve for Socket Mode
docker-compose -f docker-compose.serve.yml up
```

### Web Deployment

```bash
# Website
cd packages/web
bun run build
npx wrangler deploy

# Web App
cd packages/app
bun run build
npx wrangler pages deploy dist --project-name=nikcli-app
```

### Slack Bot Setup

1. Create Slack App at https://api.slack.com/apps
2. Add bot token scopes: `app_mentions:read`, `chat:write`, `channels:history`, `groups:history`, `files:read`
3. Set event URLs to your worker
4. Deploy worker with secrets:

```bash
bunx wrangler secret put SLACK_BOT_TOKEN
bunx wrangler secret put SLACK_SIGNING_SECRET
bunx wrangler secret put NIKCLI_URL
bunx wrangler secret put NIKCLI_USERNAME
bunx wrangler secret put NIKCLI_PASSWORD
bunx wrangler deploy
```

### Production URLs

| Service | URL |
|---------|-----|
| Website | https://nikcli.store |
| Docs | https://nikcli.store/docs |
| Web App | https://app.nikcli.store |
| Slack Bot | https://slack.nikcli.store |

---

## SDK & API

### JavaScript SDK

```bash
# Install
npm install @nikcli-ai/sdk

# Or use from workspace
import { createNikcliClient } from "@nikcli-ai/sdk/v2"
```

### Client Usage

```typescript
import { createNikcliClient } from "@nikcli-ai/sdk/v2"

const client = await createNikcliClient({
  baseUrl: "https://your-server.com",
  username: "user",
  password: "password"
})

// Send message
const response = await client.chat({
  message: "Hello!"
})

// Stream response
for await (const event of client.streamChat({
  message: "Hello!"
})) {
  console.log(event)
}

// List sessions
const sessions = await client.sessions.list()

// Get session history
const history = await client.sessions.get("session-id")

// Share session
const shareUrl = await client.sessions.share("session-id")
```

### Server API

The server exposes HTTP + SSE endpoints:

```
POST /api/chat          # Send message
GET  /api/chat/stream   # Stream responses (SSE)
GET  /api/sessions      # List sessions
GET  /api/sessions/:id  # Get session
POST /api/share         # Share session
GET  /api/share/:id     # Get shared session
```

### OpenAPI

API documentation auto-generated with OpenAPI spec.

---

## Testing

### Unit Tests

```bash
# Run tests for a package
bun test packages/nikcli

# Or within package
cd packages/nikcli
bun test
```

### E2E Tests

```bash
# Install Playwright
bunx playwright install

# Run local E2E tests
bun run test:e2e:local

# Run specific tests
bun run test:e2e:local -- --grep "settings"

# With custom server
PLAYWRIGHT_SERVER_HOST=localhost PLAYWRIGHT_SERVER_PORT=4096 bun run test:e2e:local
```

### Environment Variables for E2E

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAYWRIGHT_SERVER_HOST` | localhost | Backend host |
| `PLAYWRIGHT_SERVER_PORT` | 4096 | Backend port |
| `PLAYWRIGHT_PORT` | 3000 | Vite dev server port |
| `PLAYWRIGHT_BASE_URL` | http://localhost:3000 | Base URL |

---

## Contributing

### Getting Started

1. Fork the repository
2. Clone your fork
3. Create a branch: `git checkout -b feature/my-feature`
4. Make changes
5. Test your changes
6. Submit a PR

### Pull Request Guidelines

- **Issue First**: All PRs must reference an existing issue
- **Small PRs**: Keep changes focused and concise
- **Description**: Explain what changed and why
- **Screenshots**: Required for UI changes
- **Testing**: Explain how you verified the fix

### Commit Convention

```
<type>(<scope>): <description>

feat: add new feature
fix: bug fix
docs: documentation
chore: maintenance
refactor: code refactoring
test: tests
```

Examples:
- `feat(app): add dark mode`
- `fix(nikcli): resolve crash on startup`
- `chore: bump dependencies`

### Style Guide

- Keep functions small and focused
- Avoid unnecessary destructuring
- Avoid `else` statements (use early returns)
- Prefer `.catch()` over `try/catch`
- Avoid `any` type
- Use single-word names when possible
- Use Bun APIs (`Bun.file()`, etc.)
- Avoid `let` statements

### Good Code

```typescript
// Prefer
const result = condition ? 1 : 2

function process(data: Data) {
  if (!data.valid) return
  return data.value
}

// Avoid
let result
if (condition) result = 1
else result = 2

function process(data: Data) {
  if (data.valid) {
    return data.value
  } else {
    return undefined
  }
}
```

---

## Troubleshooting

### Common Issues

#### "Command not found: nikcli"

```bash
# Install via script
curl -fsSL https://nikcli.store/install | bash

# Or from source
cd packages/nikcli
bun run src/index.ts --help
```

#### Server 401 Unauthorized

```bash
# Check credentials
export NIKCLI_SERVER_USERNAME="user"
export NIKCLI_SERVER_PASSWORD="password"

# Verify server config
nikcli remote status
```

#### TUI not rendering correctly

```bash
# Check terminal support
echo $TERM

# Try with explicit terminal
nikcli --terminal xterm-256color
```

#### MCP server connection failed

```bash
# Verify MCP config in nikcli.jsonc
# Check server is running
# Test connection manually
```

#### Build fails

```bash
# Clear cache
rm -rf packages/*/dist
rm -rf node_modules/.cache

# Reinstall dependencies
bun install
```

### Debug Mode

```bash
# Verbose logging
NIKCLI_DEBUG=1 nikcli run "message"

# Inspect network
NIKCLI_LOG_LEVEL=debug nikcli serve
```

### Getting Help

- GitHub Issues: https://github.com/nikomatt69/nikcli/issues
- Documentation: https://nikcli.store/docs
- Discord: Join SolidJS Discord

---

## Appendix

### Keyboard Shortcuts (TUI)

| Key | Action |
|-----|--------|
| `Ctrl+C` | Cancel |
| `Ctrl+G` | Go to |
| `Ctrl+L` | Clear |
| `Ctrl+K` | Search |
| `Esc` | Close modal |

### File Locations

| Purpose | Path |
|---------|------|
| Global config | `~/.config/nikcli/` |
| Sessions | `~/.config/nikcli/sessions/` |
| Agents | `~/.config/nikcli/agent/` |
| Plugins | `~/.config/nikcli/plugins/` |
| Logs | `~/.config/nikcli/logs/` |

### Glossary

- **TUI**: Terminal User Interface
- **ACP**: Agent Communication Protocol
- **MCP**: Model Context Protocol
- **LSP**: Language Server Protocol
- **RAG**: Retrieval-Augmented Generation
- **SSE**: Server-Sent Events

### Resources

- Website: https://nikcli.store
- Docs: https://nikcli.store/docs
- GitHub: https://github.com/nikomatt69/nikcli
- NPM: https://www.npmjs.com/org/nikcli-ai
