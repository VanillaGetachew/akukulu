# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engines/package.json packages/engines/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DEV_AUTH=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_DEV_AUTH=$NEXT_PUBLIC_DEV_AUTH NEXT_TELEMETRY_DISABLED=1
RUN npm run build:packages && npm run build -w @akukulu/web

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
