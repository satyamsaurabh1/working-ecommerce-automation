# syntax=docker/dockerfile:1
#
# Multi-stage build:
#   deps    - installs production dependencies only (needs npm)
#   runtime - copies the result onto a clean base; npm itself is removed,
#             so the image carries no package manager and fewer CVEs.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci = exact versions from the lockfile (reproducible). --ignore-scripts
# blocks install-time scripts from dependencies (supply-chain hardening).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="ecommerce-api" \
      org.opencontainers.image.description="E-commerce Product and Order API" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000

# Patch OS packages, then remove npm/npx/corepack: nothing installs at runtime.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/seed.js scripts/healthcheck.js ./scripts/

# Least privilege: the built-in unprivileged "node" user, by numeric uid:gid so
# platforms can verify non-root without resolving names. Never root.
USER 1000:1000
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=4s --start-period=20s --retries=3 \
  CMD ["node", "scripts/healthcheck.js"]

CMD ["node", "src/server.js"]
