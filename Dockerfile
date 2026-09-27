# syntax=docker/dockerfile:1
# Settle in one container: the server, its MCP endpoint, and the built web UI, on port 4380.
# The runtime layout keeps the workspace's shape (/app/packages/{core,server,web}), because the
# server finds the UI at packages/web/dist and core finds its migrations and data beside its dist.

ARG NODE_IMAGE=node:26-bookworm-slim
# Node 26 ships without corepack, so pnpm comes from npm, pinned.
ARG PNPM_VERSION=12.4.2

FROM ${NODE_IMAGE} AS pnpm
ARG PNPM_VERSION
RUN npm install --global --no-fund --no-audit "pnpm@${PNPM_VERSION}"
WORKDIR /app
# Only the manifests, so the install layers are reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/skills/package.json packages/skills/

# Build: every dependency, then core, server, and web (the Skills build writes plugin/, not needed here).
FROM pnpm AS build
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/server packages/server
COPY packages/web packages/web
RUN pnpm --filter @settle/core --filter @settle/server --filter @settle/web build

# Production dependencies of the server and core only; the UI is static files once built.
FROM pnpm AS deps
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@settle/server..."

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="Settle" \
      org.opencontainers.image.description="Settle: a home's rooms, decisions, and purchases, with an MCP endpoint for the user's own Agent" \
      org.opencontainers.image.source="https://github.com/alexzfe/settle" \
      org.opencontainers.image.url="https://github.com/alexzfe/settle" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ENV NODE_ENV=production \
    SETTLE_DATA_DIR=/data \
    SETTLE_HOST=0.0.0.0 \
    SETTLE_PORT=4380
WORKDIR /app
COPY --from=deps --chown=root:root /app ./
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/core/migrations packages/core/migrations
COPY --from=build /app/packages/core/data packages/core/data
COPY --from=build /app/packages/core/fixture packages/core/fixture
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist
# The app's files stay root-owned and read-only to it; only /data is the node user's.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4380
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4380/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "packages/server/dist/main.js"]
