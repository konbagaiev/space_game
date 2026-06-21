# Game image: Node server (server/) that serves the Three.js client (client/) + JSON API.
FROM node:23-slim

# Install server deps first (better layer caching).
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# App source.
WORKDIR /app
COPY server ./server
COPY client ./client

WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=4000
# Release version (git SHA) baked into the image at build time, so the deployed artifact reports its
# own Sentry release with no mutable config to keep in sync. Read by Sentry at init (server + client via
# /api/config). Placed LAST so a new SHA only busts this cheap layer, not the npm-install layer.
# CI passes `--build-arg GIT_SHA=<full sha>`; local builds default to "dev".
ARG GIT_SHA=dev
ENV SENTRY_RELEASE=$GIT_SHA
EXPOSE 4000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
