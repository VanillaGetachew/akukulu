# One container with the API and the Telegram bot, for hosts whose free plan runs a single
# web service (Render Free has no background workers). Build from the repository root:
#   docker build -f docker/render.Dockerfile .
FROM node:22-alpine AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engines/package.json packages/engines/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/

FROM manifests AS build
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/bot apps/bot
RUN npm run build:packages && npm run build -w @akukulu/api && npm run build -w @akukulu/bot

FROM manifests AS prod-deps
RUN npm ci --omit=dev --ignore-scripts -w @akukulu/api -w @akukulu/bot -w @akukulu/shared -w @akukulu/engines

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engines/package.json packages/engines/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/engines/dist packages/engines/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/bot/dist apps/bot/dist
COPY docker/render-start.sh /app/render-start.sh
USER node
EXPOSE 4000
CMD ["sh", "/app/render-start.sh"]
