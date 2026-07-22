# Root Dockerfile: builds the YEAN API (server) from the repository root.
#
# This exists so a Railway service pointed at the repo root, with no Root
# Directory and no custom Dockerfile Path, still builds successfully (Railway
# looks for `Dockerfile` at the archive root by default). It copies only the
# server/ folder, so it is unaffected by the dashboard.
#
# Deploy the DASHBOARD with Dockerfile Path = Dockerfile.dashboard, or set the
# service Root Directory to `server` / `dashboard` to use the per-folder
# Dockerfiles instead. See docs/RAILWAY_DEPLOY.md.
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json ./
RUN npm install
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/package.json ./
EXPOSE 4000
CMD ["node", "dist/index.js"]
