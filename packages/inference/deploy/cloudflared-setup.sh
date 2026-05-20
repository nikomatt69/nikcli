#!/usr/bin/env bash
#
# Run on the server, AS ROOT, after `cloudflared tunnel login` has been done
# locally and the cert.pem is in /root/.cloudflared/cert.pem (uploaded by the orchestrator).
#
# Args:
#   TUNNEL_NAME — default: nikcli-inference
#   HOSTNAME    — required, e.g. inference.example.com

set -euo pipefail

: "${HOSTNAME:?missing HOSTNAME (e.g. inference.example.com)}"
TUNNEL_NAME="${TUNNEL_NAME:-nikcli-inference}"

if ! command -v cloudflared >/dev/null 2>&1; then
  apt-get install -y cloudflared
fi

if [[ ! -f /root/.cloudflared/cert.pem ]]; then
  echo "[cf] /root/.cloudflared/cert.pem missing — upload it first (output of 'cloudflared tunnel login' on your laptop)" >&2
  exit 1
fi

mkdir -p /etc/cloudflared

if ! cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL_NAME"; then
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2==n {print $1}')
[[ -z "$TUNNEL_ID" ]] && { echo "[cf] tunnel id not found"; exit 1; }

cp "/root/.cloudflared/${TUNNEL_ID}.json" /etc/cloudflared/credentials.json
chmod 600 /etc/cloudflared/credentials.json

cat >/etc/cloudflared/config.yml <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: /etc/cloudflared/credentials.json
originRequest:
  connectTimeout: 30s
  noTLSVerify: true
ingress:
  - hostname: ${HOSTNAME}
    service: http://127.0.0.1:3000
  - service: http_status:404
EOF

cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" || true

cloudflared service install || true
systemctl enable --now cloudflared
systemctl restart cloudflared

echo "[cf] tunnel '$TUNNEL_NAME' ($TUNNEL_ID) routing https://$HOSTNAME → http://127.0.0.1:3000"
systemctl status cloudflared --no-pager | head -10
