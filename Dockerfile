FROM oven/bun:1-alpine

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./

# Copy all packages for workspace resolution
COPY packages packages

# Install dependencies (resolves workspace:*)
RUN bun install

# Run the bot from slack package
CMD ["bun", "run", "--cwd", "packages/slack", "src/index.ts"]
