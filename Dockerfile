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
EXPOSE 4000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
