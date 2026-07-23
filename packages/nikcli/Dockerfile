FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add libgcc libstdc++ ripgrep tini

# Create a non-root user to run nikcli. Numeric UID/GID keeps the image
# portable across base-image bumps. nikcli writes its data under $HOME
# (XDG_DATA_HOME, XDG_CACHE_HOME, XDG_CONFIG_HOME), so we pre-create the
# layout and chown it before the USER switch.
RUN addgroup -g 1000 nikcli && adduser -D -u 1000 -G nikcli -h /home/nikcli nikcli \
    && mkdir -p /home/nikcli/.local/share /home/nikcli/.local/state \
                 /home/nikcli/.cache /home/nikcli/.config \
    && chown -R nikcli:nikcli /home/nikcli
ENV HOME=/home/nikcli

FROM base AS build-amd64
COPY dist/nikcli-ai-linux-x64-baseline-musl/bin/nikcli /usr/local/bin/nikcli

FROM base AS build-arm64
COPY dist/nikcli-ai-linux-arm64-musl/bin/nikcli /usr/local/bin/nikcli

ARG TARGETARCH
FROM build-${TARGETARCH}

# Drop privileges: nikcli runs as UID 1000, never as root. tini forwards
# SIGTERM/SIGINT to the entrypoint so the container stops cleanly.
USER nikcli
RUN nikcli --version
ENTRYPOINT ["/sbin/tini", "--", "nikcli"]
