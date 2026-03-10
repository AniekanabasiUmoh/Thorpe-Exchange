# =============================================================================
# Stage 1: deps — cache production node_modules separately
# This layer only rebuilds when package.json / package-lock.json changes.
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# =============================================================================
# Stage 2: builder — install all deps and compile TypeScript
# =============================================================================
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# =============================================================================
# Stage 3: runner — lean production image
# No devDeps, no TypeScript source, no build tools.
# =============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 thorpe

# Copy compiled output and prod deps
COPY --from=builder --chown=thorpe:nodejs /app/dist ./dist
COPY --from=deps    --chown=thorpe:nodejs /app/node_modules ./node_modules
COPY --chown=thorpe:nodejs package.json ./

USER thorpe

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "dist/index.js"]
