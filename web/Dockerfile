FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile
COPY web/ ./web/
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --dir web build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=node:node /app/web/public ./web/public
USER node
EXPOSE 3001
CMD ["node", "web/server.js"]
