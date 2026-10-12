# Build from the repo root: docker build -f apps/web/Dockerfile .
# Next's native compiler must run on the builder architecture, outside QEMU.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
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

# Install runtime dependencies for the destination architecture independently.
# Never ship the build platform's sharp/SWC native binaries to another platform.
FROM node:24-slim AS runtime-deps
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @whistle/web...

FROM node:24-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=9551
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
RUN rm -rf node_modules apps/web/node_modules
COPY --from=runtime-deps /repo/node_modules ./node_modules
COPY --from=runtime-deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 9551
CMD ["node", "apps/web/server.js"]
