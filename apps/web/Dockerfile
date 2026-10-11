# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @whistle/web... \
 && pnpm --filter @whistle/shared build
# API_ORIGIN is read when next.config builds the rewrites.
ARG API_ORIGIN=http://case-api:9550
ARG PRIVACY_ORIGIN=http://privacy-api:6405
ENV PRIVACY_ORIGIN=$PRIVACY_ORIGIN
ENV API_ORIGIN=$API_ORIGIN
RUN pnpm --filter @whistle/web build

FROM node:24-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=9551
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 9551
CMD ["node", "apps/web/server.js"]
