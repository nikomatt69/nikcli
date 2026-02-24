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

# Put workspace binaries (including nikcli) in PATH
ENV PATH="/app/node_modules/.bin:${PATH}"

# Run the bot from slack package
CMD ["bun", "run", "--cwd", "packages/slack", "src/index.ts"]
