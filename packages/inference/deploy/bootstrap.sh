#!/usr/bin/env bash
#
# Idempotent server bootstrap for nikcli-inference on Ubuntu 24.04 (Hetzner CX22).
# Designed to be safe to re-run.

set -euo pipefail

log()  { echo "[bootstrap] $*"; }
need() { command -v "$1" >/dev/null 2>&1; }

log "0/8 OS update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y -o Dpkg::Options::="--force-confnew"

log "1/8 base tooling"
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg ufw fail2ban htop git unzip jq

log "2/8 docker + compose plugin"
if ! need docker; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

log "3/8 swapfile (2 GB, recommended for CX22 with 4 GB RAM)"
if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "4/8 ufw firewall (allow ssh only; app reachable via cloudflared tunnel)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
yes | ufw enable

log "5/8 sysctl"
cat >/etc/sysctl.d/99-nikcli.conf <<'EOF'
fs.file-max = 1000000
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 600
net.core.somaxconn = 65535
vm.overcommit_memory = 1
EOF
sysctl --system >/dev/null

log "6/8 unprivileged service user"
if ! id nikcli >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash nikcli
  usermod -aG docker nikcli
fi

log "7/8 cloudflared apt repo (install deferred until tunnel step)"
if [[ ! -f /etc/apt/sources.list.d/cloudflared.list ]]; then
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(. /etc/os-release && echo $VERSION_CODENAME) main" | tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  apt-get update -y
fi

log "8/8 app directory"
install -d -o nikcli -g nikcli /opt/nikcli-inference /opt/nikcli-inference/logs

log "done — docker $(docker --version | awk '{print $3}'), kernel $(uname -r)"
