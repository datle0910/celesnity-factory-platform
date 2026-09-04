FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/fixtures/app-api/package.json apps/fixtures/app-api/
COPY apps/fixtures/supplier-portal/package.json apps/fixtures/supplier-portal/
COPY apps/fixtures/mqtt-simulator/package.json apps/fixtures/mqtt-simulator/
RUN npm ci --workspace @celesnity/fixture-mqtt-simulator --include-workspace-root

COPY apps/fixtures/mqtt-simulator apps/fixtures/mqtt-simulator

CMD ["npm", "run", "start", "--workspace", "@celesnity/fixture-mqtt-simulator"]
