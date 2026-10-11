FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @whistle/server... && pnpm --filter @whistle/shared build && pnpm --filter @whistle/runtime build && pnpm --filter @whistle/server build && pnpm --filter @whistle/server deploy --prod --legacy /out
FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=9550
WORKDIR /app
COPY --from=build /out .
COPY deploy/entrypoint.mjs /entrypoint.mjs
ENTRYPOINT ["node","/entrypoint.mjs"]
EXPOSE 9550
CMD ["node","dist/main.js"]
