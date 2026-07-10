#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/nikcli /data/cache /data/config /data/state

if [[ -n "${NIKCLI_AUTH_JSON:-}" ]]; then
  printf '%s' "$NIKCLI_AUTH_JSON" | base64 -d > /data/nikcli/auth.json
  chmod 600 /data/nikcli/auth.json
fi

if [[ -n "${NIKCLI_CONNECTORS_AUTH_JSON:-}" ]]; then
  printf '%s' "$NIKCLI_CONNECTORS_AUTH_JSON" | base64 -d > /data/nikcli/connectors-auth.json
  chmod 600 /data/nikcli/connectors-auth.json
fi

start_ssh() {
  local authorized_keys=""
  local ssh_host="${NIKCLI_SERVER_SSH_HOST:-0.0.0.0}"
  local ssh_port="${NIKCLI_SERVER_SSH_PORT:-2222}"
  local ssh_state_dir="/data/ssh"

  if [[ -n "${NIKCLI_SSH_AUTHORIZED_KEYS_B64:-}" ]]; then
    if ! authorized_keys="$(printf '%s' "$NIKCLI_SSH_AUTHORIZED_KEYS_B64" | base64 -d)"; then
      echo "SSH disabled: NIKCLI_SSH_AUTHORIZED_KEYS_B64 is not valid base64." >&2
      return 1
    fi
  elif [[ -n "${NIKCLI_SSH_AUTHORIZED_KEYS:-}" ]]; then
    authorized_keys="$NIKCLI_SSH_AUTHORIZED_KEYS"
  fi

  if [[ -z "${authorized_keys//[[:space:]]/}" ]]; then
    echo "SSH disabled: set NIKCLI_SSH_AUTHORIZED_KEYS or NIKCLI_SSH_AUTHORIZED_KEYS_B64."
    return
  fi

  install -d -m 700 /root/.ssh "$ssh_state_dir" || return 1
  printf '%s\n' "$authorized_keys" > /root/.ssh/authorized_keys || return 1
  chmod 600 /root/.ssh/authorized_keys || return 1

  if [[ ! -f "$ssh_state_dir/ssh_host_ed25519_key" ]]; then
    ssh-keygen -q -t ed25519 -N "" -f "$ssh_state_dir/ssh_host_ed25519_key" || return 1
  fi
  chmod 600 "$ssh_state_dir/ssh_host_ed25519_key" || return 1
  mkdir -p /run/sshd || return 1

  local sshd_options=(
    -o "Port=$ssh_port"
    -o "ListenAddress=$ssh_host"
    -o "HostKey=$ssh_state_dir/ssh_host_ed25519_key"
    -o "PidFile=/run/sshd.pid"
    -o "PermitRootLogin=prohibit-password"
    -o "PasswordAuthentication=no"
    -o "KbdInteractiveAuthentication=no"
    -o "PubkeyAuthentication=yes"
    -o "AuthorizedKeysFile=/root/.ssh/authorized_keys"
  )

  /usr/sbin/sshd -t "${sshd_options[@]}" || return 1
  /usr/sbin/sshd "${sshd_options[@]}" || return 1

  echo "SSH listening inside Railway on ${ssh_host}:${ssh_port}"
  if [[ -n "${RAILWAY_TCP_PROXY_DOMAIN:-}" && -n "${RAILWAY_TCP_PROXY_PORT:-}" ]]; then
    if [[ -z "${RAILWAY_TCP_APPLICATION_PORT:-}" || "$RAILWAY_TCP_APPLICATION_PORT" == "$ssh_port" ]]; then
      echo "SSH public: ssh -p ${RAILWAY_TCP_PROXY_PORT} root@${RAILWAY_TCP_PROXY_DOMAIN}"
    else
      echo "SSH TCP proxy targets port ${RAILWAY_TCP_APPLICATION_PORT}, expected ${ssh_port}."
    fi
  else
    echo "SSH public address unavailable: add a Railway TCP Proxy targeting port ${ssh_port}."
  fi

  if [[ -n "${RAILWAY_PRIVATE_DOMAIN:-}" ]]; then
    echo "SSH private: ssh -p ${ssh_port} root@${RAILWAY_PRIVATE_DOMAIN}"
  fi
}

if [[ "${NIKCLI_SERVER_SSH_ENABLED:-true}" == "true" ]]; then
  if ! start_ssh; then
    echo "Warning: SSH setup failed; continuing with the nikcli mobile server." >&2
  fi
fi

exec "$@"