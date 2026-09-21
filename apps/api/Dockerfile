# Build from the REPO ROOT so the workspace lockfile is available:
#   docker build -f apps/api/Dockerfile -t taskboard-api .
FROM oven/bun:1

WORKDIR /app
ENV NODE_ENV=production

# Install only what the API needs. Workspace manifests + the lockfile go first so this layer
# is cached until dependencies change.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile --production --filter @taskboard/api

COPY apps/api apps/api

WORKDIR /app/apps/api
USER bun
EXPOSE 3000

# A long-lived Bun process. Set MIGRATE_ON_START=true to apply migrations at boot, or run
# `bun run db:migrate` as your platform's release command instead.
CMD ["bun", "src/index.ts"]
