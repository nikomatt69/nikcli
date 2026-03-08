FROM oven/bun:1.3.10-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Root workspace manifest + lockfile
COPY package.json bun.lock ./
COPY patches patches

# Package manifests (dep cache layer)
COPY packages/nikcli/package.json packages/nikcli/
COPY packages/script/package.json packages/script/
COPY packages/util/package.json packages/util/
COPY packages/sdk/js/package.json packages/sdk/js/
COPY packages/remote/package.json packages/remote/
COPY packages/plugin/package.json packages/plugin/
COPY packages/companion/package.json packages/companion/
COPY packages/slack/package.json packages/slack/

RUN bun install

# Full source
COPY packages/nikcli packages/nikcli
COPY packages/script packages/script
COPY packages/util packages/util
COPY packages/sdk packages/sdk
COPY packages/remote packages/remote
COPY packages/plugin packages/plugin
COPY packages/companion packages/companion
COPY packages/slack packages/slack

RUN mkdir -p /app/repos

ENV PATH="/app/node_modules/.bin:${PATH}"

CMD ["bun", "run", "--cwd", "packages/slack", "src/index.ts"]
