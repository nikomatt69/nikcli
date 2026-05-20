#!/usr/bin/env bash
#
# Local orchestrator. Runs from your workstation.
#
# Required env:
#   HCLOUD_TOKEN     — Hetzner Cloud API token (Read & Write)
# Optional env:
#   SERVER_NAME      — default: nikcli-inference
#   SERVER_TYPE      — default: cx22
#   SERVER_IMAGE     — default: ubuntu-24.04
#   SERVER_LOCATION  — default: fsn1
#   SSH_KEY_NAME     — default: nikcli-inference
#   SSH_KEY_PATH     — default: ~/.ssh/nikcli_inference
#   ENV_LOCAL_PATH   — path to a local .env to ship to the server (REQUIRED for the deploy step)
#
# Usage:
#   ./remote-deploy.sh provision     # creates server (idempotent)
#   ./remote-deploy.sh bootstrap     # runs bootstrap.sh on server (idempotent)
#   ./remote-deploy.sh sync          # rsync the package to the server
#   ./remote-deploy.sh app           # build image + run container (uses .env)
#   ./remote-deploy.sh all           # everything above in order

set -euo pipefail

: "${HCLOUD_TOKEN:?missing HCLOUD_TOKEN}"

SERVER_NAME="${SERVER_NAME:-nikcli-inference}"
SERVER_TYPE="${SERVER_TYPE:-cx22}"
SERVER_IMAGE="${SERVER_IMAGE:-ubuntu-24.04}"
SERVER_LOCATION="${SERVER_LOCATION:-fsn1}"
SSH_KEY_NAME="${SSH_KEY_NAME:-nikcli-inference}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/nikcli_inference}"
PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"

hc() { hcloud --token "$HCLOUD_TOKEN" "$@"; }

server_ip() {
  hc server describe "$SERVER_NAME" -o json 2>/dev/null | jq -r '.public_net.ipv4.ip // empty'
}

ssh_to_server() {
  ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=~/.ssh/known_hosts "root@$(server_ip)" "$@"
}

provision() {
  echo "[provision] ssh key"
  if ! hc ssh-key describe "$SSH_KEY_NAME" >/dev/null 2>&1; then
    hc ssh-key create --name "$SSH_KEY_NAME" --public-key-from-file "${SSH_KEY_PATH}.pub" >/dev/null
  fi
  echo "[provision] server"
  if hc server describe "$SERVER_NAME" >/dev/null 2>&1; then
    echo "[provision] server $SERVER_NAME already exists at $(server_ip)"
  else
    hc server create \
      --name "$SERVER_NAME" \
      --type "$SERVER_TYPE" \
      --image "$SERVER_IMAGE" \
      --location "$SERVER_LOCATION" \
      --ssh-key "$SSH_KEY_NAME" \
      --label app=nikcli-inference
    echo "[provision] waiting 15s for sshd"
    sleep 15
  fi
  echo "[provision] IP: $(server_ip)"
}

bootstrap() {
  local ip; ip=$(server_ip)
  [[ -z "$ip" ]] && { echo "[bootstrap] no server"; exit 1; }
  echo "[bootstrap] copying bootstrap.sh to $ip"
  scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=accept-new "$PKG_DIR/deploy/bootstrap.sh" "root@$ip:/root/bootstrap.sh"
  ssh_to_server "bash /root/bootstrap.sh"
}

sync() {
  local ip; ip=$(server_ip)
  [[ -z "$ip" ]] && { echo "[sync] no server"; exit 1; }
  echo "[sync] rsync package to $ip"
  rsync -az --delete \
    --exclude node_modules --exclude dist --exclude .turbo --exclude logs --exclude .env \
    -e "ssh -i $SSH_KEY_PATH -o StrictHostKeyChecking=accept-new" \
    "$PKG_DIR/" "root@$ip:/opt/nikcli-inference/package/"
  ssh_to_server "chown -R nikcli:nikcli /opt/nikcli-inference"
}

app() {
  : "${ENV_LOCAL_PATH:?missing ENV_LOCAL_PATH — path to your .env}"
  [[ -f "$ENV_LOCAL_PATH" ]] || { echo "[app] $ENV_LOCAL_PATH not found"; exit 1; }
  local ip; ip=$(server_ip)
  [[ -z "$ip" ]] && { echo "[app] no server"; exit 1; }
  echo "[app] uploading .env"
  scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=accept-new "$ENV_LOCAL_PATH" "root@$ip:/opt/nikcli-inference/.env"
  ssh_to_server "chown nikcli:nikcli /opt/nikcli-inference/.env && chmod 600 /opt/nikcli-inference/.env"
  echo "[app] running deploy.sh as nikcli"
  ssh_to_server "sudo -u nikcli bash /opt/nikcli-inference/package/deploy/deploy.sh"
}

case "${1:-all}" in
  provision) provision ;;
  bootstrap) bootstrap ;;
  sync)      sync ;;
  app)       app ;;
  all)       provision; bootstrap; sync; app ;;
  *) echo "usage: $0 {provision|bootstrap|sync|app|all}"; exit 2 ;;
esac
