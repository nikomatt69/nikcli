FROM oven/bun:1-alpine

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./

# Copy patches required by bun install
COPY patches patches

# Copy all packages for workspace resolution
COPY packages packages

# Install dependencies (resolves workspace:*)
RUN bun install

# Build nikcli binary for the current platform (linux-x64)
RUN apk add --no-cache git && \
    cd /app/packages/nikcli && bun run script/build.ts --single --skip-install && \
    cp dist/nikcli-linux-x64/bin/nikcli /usr/local/bin/nikcli && chmod +x /usr/local/bin/nikcli

# Run the bot from slack package
CMD ["bun", "run", "--cwd", "packages/slack", "src/index.ts"]
