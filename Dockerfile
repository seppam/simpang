# syntax=docker/dockerfile:1

# Stage 1: production node_modules only, installed from the lock file.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: build the Vue operator console (served by the gateway at /console).
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

# Stage 3: runtime. There is no build step: Node 24 runs the TypeScript source directly.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
# Versioned runtime data: model catalog and prices, agent drivers, the RAG corpus,
# and eval datasets/results (the console shows the latest eval metrics per driver).
COPY --chown=node:node config ./config
COPY --chown=node:node drivers ./drivers
COPY --chown=node:node corpus ./corpus
COPY --chown=node:node eval ./eval
COPY --from=web --chown=node:node /web/dist ./web/dist

# The official node image ships a non-root "node" user (uid 1000).
USER node

EXPOSE 3000

# Uses node's built-in fetch, so no curl is needed in the alpine image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "src/server.ts"]
