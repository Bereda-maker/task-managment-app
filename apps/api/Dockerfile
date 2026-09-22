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

# GET /health needs no dependencies (no curl/wget in this image), so the check is a one-line
# Bun script. Liveness only — it must NOT depend on the database (see docs/DEPLOYMENT.md).
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# A long-lived Bun process. Handles SIGTERM gracefully (see src/index.ts): stops accepting new
# requests, lets in-flight ones finish, closes the DB pool, then exits.
# Set MIGRATE_ON_START=true to apply migrations at boot, or run `bun run db:migrate` as your
# platform's release command instead.
CMD ["bun", "src/index.ts"]
