# Sensebod Offline, ONLINE TEST SERVER: the real backend, worker and built app in one image.
# Not for the Pi (a bag runs systemd + nginx, see docs/ARCHITECTURE.md §12 and backend/README.md).
#
# Build from the repository root:
#   docker build -f deploy/online/Dockerfile -t sensebod-offline-online .
# Run (data on a volume, site on http://localhost:8080):
#   docker compose -f deploy/online/compose.yaml up --build
# Guide: docs/DEPLOY-ONLINE-DEMO.md

# ---- 1. the app, built exactly as for the Pi (no demo flag) ----
FROM node:24-bookworm-slim AS app
WORKDIR /src/app
COPY illustrations /src/illustrations
COPY app/ ./
# npm ci first deletes any node_modules that came in with the copy (e.g. a host without .dockerignore support).
RUN npm ci --no-audit --no-fund && npm run build

# ---- 2. the backend's production dependencies ----
FROM node:24-bookworm-slim AS backend
WORKDIR /src/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- 3. the server ----
# Debian 12 = the base of Raspberry Pi OS 12, so nginx is the same 1.22 as on a bag.
# ffmpeg / poppler-utils / age / ssh-keygen are the tools the worker calls for uploads, PDFs,
# encrypted backups and signed packages (backend/src/config.ts [tools]).
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx ffmpeg poppler-utils age openssh-client openssl \
 && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default
ENV SENSEBOD_DEPLOY=online \
    NODE_ENV=production \
    PORT=8080
WORKDIR /srv/sensebod-offline
COPY backend/package.json backend/package-lock.json backend/tsconfig.json backend/
COPY backend/bin backend/bin
COPY backend/src backend/src
COPY backend/migrations backend/migrations
COPY backend/seed backend/seed
COPY --from=backend /src/backend/node_modules backend/node_modules
COPY --from=app /src/app/dist web
# The sample clips the demo lessons point at (about 100 KB; see app/mock/media/README.md).
COPY app/mock/media sample-media
COPY app/deploy/security-headers.conf /etc/nginx/snippets/sensebod-offline-security-headers.conf
COPY deploy/online/online-headers.conf /etc/nginx/sensebod-offline-online-headers.conf
COPY deploy/online/nginx.conf.template deploy/nginx.conf.template
COPY deploy/online/supervise.mjs deploy/supervise.mjs
RUN rm -f sample-media/README.md && chmod -R a+rX web sample-media
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# The supervisor runs as root only to start nginx and own /data; the API, worker and tools run as "node".
CMD ["node", "deploy/supervise.mjs"]
