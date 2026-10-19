# Build from the repository root: docker build -f apps/bot/Dockerfile .
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
COPY packages/shared packages/shared
COPY apps/bot apps/bot
RUN npm run build -w @akukulu/shared && npm run build -w @akukulu/bot

FROM manifests AS prod-deps
RUN npm ci --omit=dev --ignore-scripts -w @akukulu/bot -w @akukulu/shared

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/bot/package.json apps/bot/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/bot/dist apps/bot/dist
WORKDIR /app/apps/bot
USER node
CMD ["node", "dist/main.js"]
