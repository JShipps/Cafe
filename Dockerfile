FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js ./
COPY public ./public

# The SQLite database lives on a mounted volume (see railway.toml / README).
ENV DB_PATH=/data/cafe.db
ENV PORT=8080
EXPOSE 8080

# Runs as root: hosting volumes (e.g. Railway) are mounted root-owned, and the container is the only tenant.
CMD ["node", "server.js"]
