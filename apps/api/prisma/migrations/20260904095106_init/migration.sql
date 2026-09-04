-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('APPLICATION_API', 'CRAWLER', 'DATABASE', 'MQTT');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('REGISTERED', 'VERIFIED', 'ERROR');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "Station" AS ENUM ('RECEIVING', 'SORTING', 'WASHING', 'DRYING', 'FOLDING', 'DISPATCH');

-- CreateEnum
CREATE TYPE "ContributionRole" AS ENUM ('WINNER', 'DUPLICATE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ManagementEventType" AS ENUM ('ACKNOWLEDGE_EXCEPTION', 'BLOCK', 'RESUME', 'NOTE');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'REGISTERED',
    "config" JSONB NOT NULL,
    "secretEnvVar" TEXT,
    "secretCipher" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerifyError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsStored" INTEGER NOT NULL DEFAULT 0,
    "recordsDuplicate" INTEGER NOT NULL DEFAULT 0,
    "recordsRejected" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "stats" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "CollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "collectionRunId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT,
    "station" "Station",
    "quantity" INTEGER,
    "occurredAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3),
    "parseError" TEXT,

    CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalEvent" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "station" "Station" NOT NULL,
    "quantity" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "hasConflict" BOOLEAN NOT NULL DEFAULT false,
    "resolution" JSONB NOT NULL,

    CONSTRAINT "CanonicalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalEventContribution" (
    "id" TEXT NOT NULL,
    "canonicalEventId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "role" "ContributionRole" NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "CanonicalEventContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchLink" (
    "batchId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "plannedQuantity" INTEGER,
    "linenType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchLink_pkey" PRIMARY KEY ("batchId")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "workOrderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "customer" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("workOrderId")
);

-- CreateTable
CREATE TABLE "ManagementEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" "ManagementEventType" NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_organizationId_name_key" ON "Source"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CollectionRun_sourceId_startedAt_idx" ON "CollectionRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "SourceRecord_sourceId_sourceRecordId_idx" ON "SourceRecord"("sourceId", "sourceRecordId");

-- CreateIndex
CREATE INDEX "SourceRecord_batchId_station_idx" ON "SourceRecord"("batchId", "station");

-- CreateIndex
CREATE INDEX "SourceRecord_collectionRunId_idx" ON "SourceRecord"("collectionRunId");

-- CreateIndex
CREATE INDEX "CanonicalEvent_batchId_idx" ON "CanonicalEvent"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalEvent_batchId_station_key" ON "CanonicalEvent"("batchId", "station");

-- CreateIndex
CREATE INDEX "CanonicalEventContribution_sourceRecordId_idx" ON "CanonicalEventContribution"("sourceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalEventContribution_canonicalEventId_sourceRecordId_key" ON "CanonicalEventContribution"("canonicalEventId", "sourceRecordId");

-- CreateIndex
CREATE INDEX "ManagementEvent_batchId_createdAt_idx" ON "ManagementEvent"("batchId", "createdAt");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRun" ADD CONSTRAINT "CollectionRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "CollectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalEventContribution" ADD CONSTRAINT "CanonicalEventContribution_canonicalEventId_fkey" FOREIGN KEY ("canonicalEventId") REFERENCES "CanonicalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalEventContribution" ADD CONSTRAINT "CanonicalEventContribution_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "SourceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementEvent" ADD CONSTRAINT "ManagementEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
