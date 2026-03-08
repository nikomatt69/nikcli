#!/bin/bash
# Start script for the NikCLI Slack bot + Tunnel
# Usage: ./start.sh [ngrok]

# Setup trap for cleanup on exit early
trap "echo 'Shutting down...'; kill \$TUNNEL_PID 2>/dev/null; killall cloudflared 2>/dev/null; killall ngrok 2>/dev/null; exit 0" INT TERM EXIT

# Start the tunnel in the background
if [ "$1" = "ngrok" ]; then
    export USE_NGROK=1
    echo "Starting with ngrok tunnel..."
else
    export USE_NGROK=0
    echo "Starting with cloudflared tunnel (default)..."
fi

./tunnel.sh &
TUNNEL_PID=$!

# Wait a moment for tunnel to start
sleep 2

# Start the Slack bot
echo "Starting NikCLI Slack bot..."
bun run src/index.ts &
BOT_PID=$!

# Wait for both processes
wait $BOT_PID
