# syntax=docker/dockerfile:1

# ---- deps: install all dependencies (cached on package*.json) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript, then drop devDependencies ----
FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runner: minimal production image ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma

# Writable dir for uploaded room images (mount a volume here in production).
RUN mkdir -p /app/uploads && chown node:node /app/uploads

# Never run as root in production.
USER node
EXPOSE 3000

# Liveness only: a DB outage should not get the API container killed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" > /dev/null || exit 1

CMD ["node", "dist/main.js"]
