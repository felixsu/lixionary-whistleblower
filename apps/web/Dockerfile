# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @whistle/web... \
 && pnpm --filter @whistle/shared build
# API_ORIGIN is read when next.config builds the rewrites.
ARG API_ORIGIN=http://server:6400
ENV API_ORIGIN=$API_ORIGIN
RUN pnpm --filter @whistle/web build

FROM node:24-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=6401
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 6401
CMD ["node", "apps/web/server.js"]
