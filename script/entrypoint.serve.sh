#!/bin/bash

NIKCLI="bun run --cwd /app/packages/nikcli --conditions=browser src/index.ts"

mkdir -p /data/nikcli /data/cache /data/config /data/state

LAN_IP="${HOST_IP:-192.168.1.19}"
PORT="${PORT:-4096}"

TOKEN_FILE=/data/nikcli/.dev-token
if [ ! -f "$TOKEN_FILE" ]; then
  echo "Generating Bearer token for web app..."
  RAW=$($NIKCLI mobile pair --public-url "http://${LAN_IP}:${PORT}" --name "web-dev" 2>/dev/null)
  TOKEN=$(echo "$RAW" | grep "^Token:" | awk '{print $2}')
  if [ -n "$TOKEN" ]; then
    echo "$TOKEN" > "$TOKEN_FILE"
  fi
fi

echo ""
echo "==================== ACCESSO ===================="
echo " Password:     nikcli / dev123 (mobile/terminal)"
if [ -f "$TOKEN_FILE" ]; then
  T=$(cat "$TOKEN_FILE" | tr -d ' \t\n\r')
  echo " Deep Link:   nikcli://connect?server=http://${LAN_IP}:${PORT}&token=${T}"
  echo "              (incolla su https://nikcli.store/app/connect)"
fi
echo " Server:      http://${LAN_IP}:${PORT}"
echo " Web App:     https://nikcli.store/app/connect"
echo "=================================================="
echo ""

exec $NIKCLI mobile serve --hostname 0.0.0.0 --port ${PORT}
