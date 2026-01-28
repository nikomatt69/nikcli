# @nikcli-ai/slack

Slack bot integration for nikcli that creates threaded conversations and supports voice messages.

## Setup

### 1. Create Slack App

Go to https://api.slack.com/apps and click **"Create New App"**

- Choose "From an app manifest"
- Select your workspace
- Paste this manifest:

```yaml
_metadata:
  major_version: 1
  minor_version: 1
display_information:
  name: NikCLI Bot
  description: AI assistant powered by nikcli with voice message support
  background_color: "#1a1a2e"
features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: true
  bot_user:
    display_name: NikCLI
    always_online: true
  slash_commands:
    - command: /test
      url: https://your-domain.com/slack/events
      description: Test the bot
      should_escape: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - app_mentions:read
      - channels:history
      - groups:history
      - files:read
      - commands
settings:
  event_subscriptions:
    request_url: https://your-domain.com/slack/events
    bot_events:
      - message.app_home
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  interactivity:
    request_url: https://your-domain.com/slack/interactive
  socket_mode:
    enabled: false
```

### 2. Install to Workspace

1. Go to **Settings > Install App**
2. Click "Install to Workspace"
3. Grant the required permissions

---

## Deployment Options

### Option 1: Cloudflare Workers (HTTP Mode) - Recommended for Serverless

```bash
cd packages/slack

# Install dependencies
bun install

# Login to Cloudflare
npx wrangler login

# Set secrets
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_SIGNING_SECRET
npx wrangler secret put OPENAI_API_KEY

# (Optional) Remote nikcli server
npx wrangler secret put NIKCLI_URL
npx wrangler secret put NIKCLI_API_KEY

# Deploy
bun run deploy

# Or for local testing
bun run dev:worker
```

After deploy:

1. Copy your worker URL (e.g., `https://nikcli-slack.yourname.workers.dev`)
2. Update Slack app manifest URLs
3. Reinstall the app

### Option 2: Local Development (Socket Mode)

```bash
cd packages/slack

# Install dependencies
bun install

# Create .env file
cp .env.example .env

# Edit .env with your credentials
nano .env

# Run locally
bun dev
```

### Option 3: Docker (Socket Mode)

```bash
cd packages/slack

# Build
docker build -t nikcli-slack .

# Run
docker run -d \
  --name nikcli-slack-bot \
  -e SLACK_BOT_TOKEN=xoxb-... \
  -e SLACK_SIGNING_SECRET=... \
  -e SLACK_APP_TOKEN=xapp-... \
  -e OPENAI_API_KEY=sk-... \
  nikcli-slack
```

### Option 4: Railway (Socket Mode)

```bash
cd packages/slack

# Install Railway CLI
npm i -g @railway/cli

# Login and init
railway login
railway init

# Set environment variables
railway variables set \
  SLACK_BOT_TOKEN=xoxb-... \
  SLACK_SIGNING_SECRET=... \
  SLACK_APP_TOKEN=xapp-... \
  OPENAI_API_KEY=sk-...

# Deploy
railway up
```

---

## File Structure

```
packages/slack/
├── src/
│   ├── index.ts      # Socket Mode (local/server deployment)
│   └── worker.ts     # HTTP Mode (Cloudflare Workers)
├── wrangler.toml     # Cloudflare Workers config
├── Dockerfile        # Docker image
├── docker-compose.yml
└── .env.example
```

---

## Environment Variables

| Variable               | Required    | Used By   | Description                                           |
| ---------------------- | ----------- | --------- | ----------------------------------------------------- |
| `SLACK_BOT_TOKEN`      | Yes         | Both      | Bot User OAuth Token (starts with `xoxb-`)            |
| `SLACK_SIGNING_SECRET` | Yes         | Both      | Slack Signing Secret                                  |
| `SLACK_APP_TOKEN`      | Socket Mode | index.ts  | App-Level Token (starts with `xapp-`)                 |
| `OPENAI_API_KEY`       | No          | Both      | OpenAI API Key for voice transcription                |
| `NIKCLI_URL`           | Workers     | worker.ts | URL of nikcli server (default: http://localhost:4000) |
| `NIKCLI_API_KEY`       | Workers     | worker.ts | API key for authenticated nikcli server               |

---

## Usage

### Text Messages

Send a message to the bot in a channel:

```
@NikCLI Come posso ottimizzare questo codice?
```

### Voice Messages

1. Record a voice message in Slack (🎤 icon)
2. Send it to a channel where NikCLI is present
3. The bot transcribes and responds

### Commands

- `/test` - Test the bot is running

---

## Troubleshooting

### Bot not responding?

**Cloudflare Workers:**

1. Check Event Subscriptions URL in Slack dashboard
2. Verify secrets: `npx wrangler secret list`
3. Check logs: `npx wrangler tail`

**Socket Mode:**

1. Check the bot is running: `bun dev`
2. Verify tokens are correct
3. Check the bot is invited to channel: `/invite @NikCLI`

### Voice transcription not working?

1. Verify `OPENAI_API_KEY` is set
2. Check audio format (MP3, OGG, WAV, M4A, WebM)
3. Review logs for errors

### Cloudflare Workers timeout?

Voice transcription may timeout on free Workers plan. Consider:

- Upgrading to Paid plan
- Offloading transcription to a separate service
