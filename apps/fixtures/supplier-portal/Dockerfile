FROM node:24-alpine

WORKDIR /app

# The whole workspace manifest set is copied so npm can resolve the lockfile,
# but only this fixture's dependency subtree is installed.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/fixtures/app-api/package.json apps/fixtures/app-api/
COPY apps/fixtures/supplier-portal/package.json apps/fixtures/supplier-portal/
COPY apps/fixtures/mqtt-simulator/package.json apps/fixtures/mqtt-simulator/
RUN npm ci --workspace @celesnity/fixture-supplier-portal --include-workspace-root

COPY apps/fixtures/supplier-portal apps/fixtures/supplier-portal

ENV PORT=4002
EXPOSE 4002

CMD ["npm", "run", "start", "--workspace", "@celesnity/fixture-supplier-portal"]
