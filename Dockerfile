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

# Create nikcli wrapper — runs the TS source via bun (no compiled binary needed)
RUN printf '#!/bin/sh\nexec bun run --conditions=browser /app/packages/nikcli/src/index.ts "$@"\n' > /usr/local/bin/nikcli && chmod +x /usr/local/bin/nikcli

# Run the bot from slack package
CMD ["bun", "run", "--cwd", "packages/slack", "src/index.ts"]
