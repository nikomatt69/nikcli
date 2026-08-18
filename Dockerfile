FROM oven/bun:1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates git openssh-server ripgrep && rm -rf /var/lib/apt/lists/*

# Copy root workspace files
COPY package.json bun.lock ./

# Copy patches required by bun install
COPY patches patches

# Copy only workspace manifests needed to resolve nikcli dependencies
COPY packages/nikcli/package.json packages/nikcli/
COPY packages/script/package.json packages/script/
COPY packages/util/package.json packages/util/
COPY packages/sdk/js/package.json packages/sdk/js/
COPY packages/remote/package.json packages/remote/
COPY packages/plugin/package.json packages/plugin/
COPY packages/companion/package.json packages/companion/
COPY packages/slack/package.json packages/slack/
COPY packages/discord/package.json packages/discord/
COPY packages/identity/package.json packages/identity/
COPY packages/auth/package.json packages/auth/
COPY packages/llm/package.json packages/llm/
COPY packages/http-recorder/package.json packages/http-recorder/
COPY packages/httpapi-codegen/package.json packages/httpapi-codegen/
COPY packages/simulation/package.json packages/simulation/
COPY packages/tui/package.json packages/tui/
COPY packages/tui-image/package.json packages/tui-image/
COPY packages/tui-math/package.json packages/tui-math/
COPY packages/terminal-control/package.json packages/terminal-control/
COPY packages/browser-control/package.json packages/browser-control/
COPY packages/computer-use/package.json packages/computer-use/
COPY github/package.json github/

# Stub webrenderer (native Rust build not required for the nikcli binary)
RUN mkdir -p packages/webrenderer && \
    printf '{"name":"@opentui/webrenderer","version":"0.0.0","private":true}\n' > packages/webrenderer/package.json

# Install dependencies (resolves workspace:*)
RUN bun install

# Headless Chromium for @nikcli-ai/browser-control (the `browser` tool). Pinned
# to the exact playwright version browser-control depends on so the browser
# revision matches what gets bundled into the compiled nikcli binary.
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN bunx --bun playwright@1.61.0 install --with-deps chromium

# Copy package sources required to build the nikcli binary
COPY packages/nikcli packages/nikcli
COPY packages/script packages/script
COPY packages/util packages/util
COPY packages/sdk/js packages/sdk/js
COPY packages/remote packages/remote
COPY packages/plugin packages/plugin
COPY packages/companion packages/companion
COPY packages/slack packages/slack
COPY packages/identity packages/identity
COPY packages/auth packages/auth
COPY packages/llm packages/llm
COPY packages/http-recorder packages/http-recorder
COPY packages/httpapi-codegen packages/httpapi-codegen
COPY packages/simulation packages/simulation
COPY packages/tui packages/tui
COPY packages/tui-image packages/tui-image
COPY packages/tui-math packages/tui-math
COPY packages/terminal-control packages/terminal-control
COPY packages/browser-control packages/browser-control
COPY packages/computer-use packages/computer-use
COPY packages/native-control packages/native-control
COPY packages/native-ui-protocol packages/native-ui-protocol
COPY github github

# Build nikcli binary for the current platform (linux-x64)
# NIKCLI_CHANNEL avoids git branch lookup in build script (no .git in Docker context)
ENV NIKCLI_CHANNEL=latest
ENV NIKCLI_VERSION=1.216.0
ENV XDG_DATA_HOME=/data
ENV XDG_CACHE_HOME=/data/cache
ENV XDG_CONFIG_HOME=/data/config
ENV XDG_STATE_HOME=/data/state
RUN cd /app/packages/nikcli && bun run script/build.ts --single --skip-install && \
    set -- dist/*-linux-*/bin/nikcli && cp "$1" /usr/local/bin/nikcli && chmod +x /usr/local/bin/nikcli

COPY packages/nikcli/scripts/railway-entrypoint.sh /usr/local/bin/nikcli-railway-entrypoint
RUN chmod +x /usr/local/bin/nikcli-railway-entrypoint

ENV NIKCLI_SERVER_SSH_ENABLED=true
ENV NIKCLI_SERVER_SSH_PORT=2222
ENV NIKCLI_SERVER_SSH_HOST=0.0.0.0
# Configure one of these Railway variables to enable key-only SSH:
# NIKCLI_SSH_AUTHORIZED_KEYS="ssh-ed25519 AAAA..."
# NIKCLI_SSH_AUTHORIZED_KEYS_B64="<base64 authorized_keys>"

EXPOSE 4096 2222

ENTRYPOINT ["/usr/local/bin/nikcli-railway-entrypoint"]

# Default to the mobile host without auto-pairing
CMD ["nikcli", "mobile", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
