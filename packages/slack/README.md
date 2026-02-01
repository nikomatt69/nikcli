# nikcli Slack Integration

Deploy nikcli as a Slack bot using Cloudflare Workers.

## Architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│  Slack API      │────▶│  Cloudflare Worker       │────▶│  Nikcli Server  │
│                 │     │  nikcli-slack            │     │  (localhost)    │
└─────────────────┘     │  - Basic Auth            │     │  - Port 4096    │
                        │  - KV Session Storage    │     │  - Basic Auth   │
                        │  - Voice Transcription   │     └─────────────────┘
                        └──────────────────────────┘
                                      │
                           ┌──────────▼──────────┐
                           │  cloudflared tunnel │
                           │  (esponi server)    │
                           └─────────────────────┘
```

## Prerequisites

- [Cloudflare Workers](https://workers.cloudflare.com/) account
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-update/) installed
- Slack App with Bot Token and Signing Secret
- nikcli server running with Basic Auth

## Quick Start

### 1. Setup nikcli Server

```bash
# Start nikcli server with external access
export NIKCLI_SERVER_PASSWORD="your-secure-password"
export NIKCLI_SERVER_USERNAME="slackbot"
nikcli serve --port 4096 --hostname 0.0.0.0 --mdns
```

### 2. Expose Server to Internet

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Run tunnel (separate terminal)
cloudflared tunnel --url http://localhost:4096

# Output: https://random-name.trycloudflare.com
# Save this URL for NIKCLI_URL
```

### 3. Create Slack App

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Click "Create New App" → "From an app manifest"
3. Use the manifest below:

```yaml
_metadata:
  major_version: 1
  minor_version: 1
display_information:
  name: nikcli
  description: AI coding assistant for Slack
  background_color: "#1a1a2e"
features:
  bot_user:
    display_name: nikcli
    always_online: true
  event_subscriptions:
    enabled: true
    request_url: https://your-worker.workers.dev/slack/events
  interactivity:
    enabled: true
    request_url: https://your-worker.workers.dev/slack/interactive
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - channels:history
      - groups:history
      - files:read
settings:
  event_subscriptions:
    bot_events:
      - app_mentions
      - message.channels
      - message.groups
  interactivity:
    placeholder_text: Ask nikcli...
  org_deploy_enabled: false
  socket_mode_enabled: false
```

4. Install to workspace
5. Copy Bot Token (`xoxb-...`) and Signing Secret

### 4. Deploy Worker

```bash
cd packages/slack

# Create KV namespace for sessions
bunx wrangler kv:namespace create "SESSIONS" --preview=false

# Set secrets
bunx wrangler secret put SLACK_BOT_TOKEN
bunx wrangler secret put SLACK_SIGNING_SECRET
bunx wrangler secret put SLACK_CLIENT_ID
bunx wrangler secret put SLACK_CLIENT_SECRET
bunx wrangler secret put OPENAI_API_KEY
bunx wrangler secret put NIKCLI_URL
bunx wrangler secret put NIKCLI_USERNAME
bunx wrangler secret put NIKCLI_PASSWORD

# Deploy with custom domain (optional)
bunx wrangler deploy src/worker.ts --name nikcli-slack --routes 'slack.nikcli.store/*'

# Or without custom domain
# bunx wrangler deploy src/worker.ts --name nikcli-slack
```

### 5. Update Slack App URLs

After deployment, update your Slack app:

- **Event Subscriptions URL**: `https://slack.nikcli.store/slack/events`
- **Interactivity URL**: `https://slack.nikcli.store/slack/interactive`

Reinstall the app.

## Environment Variables

| Variable               | Required | Description                                    |
| ---------------------- | -------- | ---------------------------------------------- |
| `SLACK_BOT_TOKEN`      | Yes      | Bot OAuth Token (`xoxb-...`)                   |
| `SLACK_SIGNING_SECRET` | Yes      | Slack signing secret                           |
| `SLACK_CLIENT_ID`      | No       | Slack OAuth Client ID (for /slack/install)     |
| `SLACK_CLIENT_SECRET`  | No       | Slack OAuth Client Secret (for /slack/install) |
| `SLACK_APP_TOKEN`      | No       | Required only for Socket Mode (`bun run dev`)  |
| `OPENAI_API_KEY`       | No       | OpenAI API for voice transcription             |
| `NIKCLI_URL`           | Yes      | Your nikcli server URL                         |
| `NIKCLI_USERNAME`      | No       | Basic Auth username (default: `nikcli`)        |
| `NIKCLI_PASSWORD`      | Yes      | Basic Auth password (`NIKCLI_SERVER_PASSWORD`) |

## Commands

In Slack, mention the bot to start a conversation:

```
@nikcli Write a function to calculate fibonacci
```

Features:

- Text messages
- Voice message transcription (with `OPENAI_API_KEY`)
- Thread-based sessions (continue conversations in threads)
- Session sharing via URL

## Development

```bash
# Run locally
bun run dev:worker

# View logs
bunx wrangler tail

# Typecheck
bun run typecheck
```

## Troubleshooting

### Worker not receiving events

- Verify Event Subscriptions URL is correct (`https://slack.nikcli.store/slack/events`) and uses HTTPS
- Check Slack app has required bot scopes
- Reinstall app after changing scopes

### 401 Unauthorized from nikcli server

- Verify `NIKCLI_USERNAME` and `NIKCLI_PASSWORD` match server config
- Ensure server is running and accessible at `NIKCLI_URL`

### Voice transcription not working

- Verify `OPENAI_API_KEY` is set
- Check audio file format (mp3, ogg, wav, m4a, webm)

### Sessions not persisting

- Verify KV namespace is created and bound in wrangler.toml
- Check worker logs for KV errors

## Files

```
packages/slack/
├── src/
│   ├── index.ts      # Socket Mode (local/VM deployment)
│   └── worker.ts     # Cloudflare Workers Mode
├── wrangler.toml     # Workers configuration
├── Dockerfile        # Socket Mode container
└── README.md         # This file
```
