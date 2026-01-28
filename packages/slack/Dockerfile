FROM oven/bun:1-alpine

WORKDIR /app

# Copy entire repository for workspace dependencies
COPY . .

# Install dependencies (resolves workspace:*)
RUN bun install --prod

# Run the bot
CMD ["bun", "run", "--cwd", "packages/slack", "src/index.ts"]
