# syntax=docker/dockerfile:1

# ---- deps: install all dependencies (cached on package*.json) ----
FROM node:24-alpine AS deps
# Prisma's query and migration engines link against OpenSSL.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: generate the Prisma client, compile, drop devDependencies ----
FROM deps AS build
COPY . .
# `npm run build` = prisma generate + nest build. After pruning, generate
# again so the client is guaranteed to be present in the production tree.
RUN npm run build \
 && npm prune --omit=dev \
 && npx prisma generate

# ---- runner: minimal production image ----
FROM node:24-alpine AS runner
RUN apk add --no-cache openssl
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Schema + migrations, applied by the entrypoint with `prisma migrate deploy`.
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Strip CRLF in case the repo was checked out on Windows, then make the
# entrypoint executable. Writable dir for uploaded room images (mount a
# volume here in production).
RUN sed -i 's/\r$//' docker-entrypoint.sh \
 && chmod +x docker-entrypoint.sh \
 && mkdir -p /app/uploads && chown node:node /app/uploads

# Never run as root in production.
USER node
EXPOSE 3000

# Liveness only: a DB outage should not get the API container killed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" > /dev/null || exit 1

# Migrate (and optionally seed), then start the API. See docker-entrypoint.sh.
CMD ["./docker-entrypoint.sh"]
