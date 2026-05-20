# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3-alpine AS base
WORKDIR /app

FROM base AS deps
COPY deploy/package.runtime.json ./package.json
RUN bun install --production --no-save

FROM base AS build
COPY deploy/package.runtime.json ./package.json
RUN bun install --production --no-save
COPY tsconfig.json ./
COPY src ./src
RUN bun build src/main.ts --outdir=dist --target=bun --minify

FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY deploy/package.runtime.json ./package.json

RUN addgroup -g 1001 nikcli && adduser -D -u 1001 -G nikcli nikcli && chown -R nikcli:nikcli /app
USER nikcli

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["bun", "run", "dist/main.js"]
