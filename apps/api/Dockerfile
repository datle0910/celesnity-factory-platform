FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/fixtures/app-api/package.json apps/fixtures/app-api/
COPY apps/fixtures/supplier-portal/package.json apps/fixtures/supplier-portal/
COPY apps/fixtures/mqtt-simulator/package.json apps/fixtures/mqtt-simulator/
RUN npm ci --workspace @celesnity/api --include-workspace-root

COPY apps/api apps/api
# prisma generate only reads the schema, it never connects — but prisma.config.ts
# resolves DATABASE_URL eagerly, so the build stage needs a syntactically valid
# placeholder. The real value is supplied at container run time.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npm run prisma:generate --workspace @celesnity/api
RUN npm run build --workspace @celesnity/api

# --- Runtime ----------------------------------------------------------------
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/fixtures/app-api/package.json apps/fixtures/app-api/
COPY apps/fixtures/supplier-portal/package.json apps/fixtures/supplier-portal/
COPY apps/fixtures/mqtt-simulator/package.json apps/fixtures/mqtt-simulator/
RUN npm ci --workspace @celesnity/api --include-workspace-root --omit=dev

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/node_modules/@prisma/client node_modules/@prisma/client
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/api/src/seed.ts apps/api/src/seed.ts

WORKDIR /app/apps/api

EXPOSE 4000

# Migrations are applied and the demo sources seeded on every start; both are
# idempotent, so this is safe to run against a database that already has them.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/seed.ts && node dist/main.js"]
