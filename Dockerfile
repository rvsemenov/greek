# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
# better-sqlite3 может собираться из исходников на arm64, поэтому нужны компиляторы.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci

COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci

COPY server server
COPY web web
RUN cd web && npm run build \
 && cd ../server && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    CONTENT_DIR=/app/content \
    WEB_DIST=/app/web/dist

COPY --from=build /app/server/package.json /app/server/
COPY --from=build /app/server/node_modules /app/server/node_modules
COPY --from=build /app/server/dist /app/server/dist
COPY --from=build /app/web/dist /app/web/dist

RUN mkdir -p /app/data
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
