# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @whistle/server... \
 && pnpm --filter @whistle/shared build \
 && pnpm --filter @whistle/server build \
 && pnpm --filter @whistle/server deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=6400 UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 6400
CMD ["node", "dist/main.js"]
