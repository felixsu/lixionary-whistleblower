FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @whistle/privacy... && pnpm --filter @whistle/shared build && pnpm --filter @whistle/runtime build && pnpm --filter @whistle/privacy build && pnpm --filter @whistle/privacy deploy --prod --legacy /out
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends clamdscan poppler-utils libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=6405 PRIVACY_STORAGE=/data/privacy
WORKDIR /app
COPY --from=build /out .
COPY deploy/clamd-client.conf /etc/clamav/clamd.conf
RUN mkdir -p /data/privacy && chown -R node:node /data
COPY deploy/entrypoint.mjs /entrypoint.mjs
ENTRYPOINT ["node","/entrypoint.mjs"]
EXPOSE 6405
CMD ["node","dist/main.js"]
