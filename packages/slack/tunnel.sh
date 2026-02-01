#!/bin/bash
# nikcli-slack-tunnel.sh
# Script to keep NIKCLI_URL updated with cloudflared tunnel

# Kill any existing cloudflared tunnel
killall cloudflared 2>/dev/null || true
sleep 1

echo "Starting cloudflared tunnel for nikcli server..."
echo ""

# Start tunnel and capture output
TUNNEL_OUTPUT=$(cloudflared tunnel --url http://localhost:4096 2>&1)

# Extract tunnel URL
TUNNEL_URL=$(echo "$TUNNEL_OUTPUT" | grep -o 'https://[^[:space:]]*trycloudflare.com' | head -1)

if [ -z "$TUNNEL_URL" ]; then
    echo "Error: Could not extract tunnel URL"
    exit 1
fi

echo "✅ Tunnel created: $TUNNEL_URL"
echo ""

# Update NIKCLI_URL in Cloudflare Workers
echo "Updating NIKCLI_URL secret..."
echo "$TUNNEL_URL" | bunx wrangler secret put NIKCLI_URL --name nikcli-slack

echo ""
echo "✅ NIKCLI_URL updated!"
echo ""
echo "To use nikcli via Slack:"
echo "1. Keep this terminal running"
echo "2. Mention @nikcli in Slack to start a conversation"
echo ""
echo "⚠️ NOTE: This URL will change if you restart this script"
echo "   For a permanent solution, consider:"
echo "   - Deploy nikcli server on a VPS with static IP"
echo "   - Set up a named tunnel with Cloudflare Zero Trust"
