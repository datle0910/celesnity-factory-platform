FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/fixtures/app-api/package.json apps/fixtures/app-api/
COPY apps/fixtures/supplier-portal/package.json apps/fixtures/supplier-portal/
COPY apps/fixtures/mqtt-simulator/package.json apps/fixtures/mqtt-simulator/
RUN npm ci --workspace @celesnity/web --include-workspace-root

COPY apps/web apps/web

# Baked into the client bundle at build time — the browser cannot resolve the
# compose network's service names, so this always has to be a host reachable
# from wherever the browser runs.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

RUN npm run build --workspace @celesnity/web

# --- Runtime ----------------------------------------------------------------
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

WORKDIR /app/apps/web

EXPOSE 3000
CMD ["node", "server.js"]
