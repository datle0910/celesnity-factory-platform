import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Station } from '@prisma/client';
import { resolveObservations, type Observation, type Resolution } from '../domain/dedup';
import { STATION_ORDER, stationIndex } from '../domain/stations';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Turns collected observations into accepted events.
 *
 * Canonical state is treated as a pure function of the stored source records:
 * the service reads every observation for a batch, applies the deduplication
 * policy, and writes the result. Running it twice over unchanged records
 * produces exactly the same canonical events, which means a rebuild is always
 * safe and a collection run never has to reason about what it might be
 * overwriting.
 *
 * Source records themselves are never modified here. They are the audit trail;
 * this layer only ever adds an interpretation of them.
 */
@Injectable()
export class NormalizationService {
  private readonly logger = new Logger(NormalizationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param batchIds restricts the rebuild to the batches a run touched. Passing
   *                 nothing rebuilds everything, which is what the reconcile
   *                 endpoint uses.
   */
  async rebuild(batchIds?: readonly string[]): Promise<{ batchCount: number; eventCount: number }> {
    const scope = batchIds && batchIds.length > 0 ? [...new Set(batchIds)] : undefined;

    const records = await this.prisma.sourceRecord.findMany({
      where: {
        batchId: scope ? { in: scope } : { not: null },
        station: { not: null },
        parseError: null,
      },
      select: {
        id: true,
        sourceId: true,
        sourceRecordId: true,
        batchId: true,
        station: true,
        quantity: true,
        occurredAt: true,
        recordedAt: true,
        collectedAt: true,
        source: { select: { type: true } },
      },
    });

    // batchId -> station -> observations
    const grouped = new Map<string, Map<Station, Observation[]>>();

    for (const record of records) {
      if (!record.batchId || !record.station || !record.occurredAt) {
        continue;
      }

      const byStation = grouped.get(record.batchId) ?? new Map<Station, Observation[]>();
      const observations = byStation.get(record.station) ?? [];

      observations.push({
        recordId: record.id,
        sourceId: record.sourceId,
        sourceType: record.source.type,
        sourceRecordId: record.sourceRecordId,
        quantity: record.quantity,
        occurredAt: record.occurredAt,
        // When the *source* knew about the event, which is what lateness is
        // about. Deliberately not the time we collected it: collection order
        // reflects which source an operator happened to run first, so using it
        // would mark half the board late for no better reason than click order.
        // Sources that expose no recorded-at are taken at face value, as having
        // recorded the event when it happened.
        observedAt: record.recordedAt ?? record.occurredAt,
      });

      byStation.set(record.station, observations);
      grouped.set(record.batchId, byStation);
    }

    let eventCount = 0;
    for (const [batchId, byStation] of grouped) {
      eventCount += await this.rebuildBatch(batchId, byStation);
    }

    this.logger.log(`normalised ${eventCount} events across ${grouped.size} batches`);
    return { batchCount: grouped.size, eventCount };
  }

  private async rebuildBatch(batchId: string, byStation: Map<Station, Observation[]>): Promise<number> {
    const resolutions = new Map<Station, Resolution>();
    for (const [station, observations] of byStation) {
      const resolution = resolveObservations(station, observations);
      if (resolution) {
        resolutions.set(station, resolution);
      }
    }

    if (resolutions.size === 0) {
      return 0;
    }

    const lateness = detectLateArrivals(resolutions);

    await this.prisma.$transaction(
      async (tx) => {
        for (const [station, resolution] of resolutions) {
          const event = await tx.canonicalEvent.upsert({
            where: { batchId_station: { batchId, station } },
            create: {
              batchId,
              station,
              quantity: resolution.winner.quantity,
              occurredAt: resolution.winner.occurredAt,
              observedAt: resolution.winner.observedAt,
              isLate: lateness.get(station) ?? false,
              hasConflict: resolution.hasConflict,
              resolution: buildResolutionSummary(resolution) as Prisma.InputJsonValue,
            },
            // acceptedAt is deliberately not touched: it records when the
            // platform first accepted this event, not when it last recomputed it.
            update: {
              quantity: resolution.winner.quantity,
              occurredAt: resolution.winner.occurredAt,
              observedAt: resolution.winner.observedAt,
              isLate: lateness.get(station) ?? false,
              hasConflict: resolution.hasConflict,
              resolution: buildResolutionSummary(resolution) as Prisma.InputJsonValue,
            },
            select: { id: true },
          });

          // Contributions are rewritten wholesale because they are derived: a
          // later run may reclassify a record from winner to superseded.
          await tx.canonicalEventContribution.deleteMany({ where: { canonicalEventId: event.id } });
          await tx.canonicalEventContribution.createMany({
            data: resolution.contributions.map((contribution) => ({
              canonicalEventId: event.id,
              sourceRecordId: contribution.recordId,
              role: contribution.role,
              reason: contribution.reason,
            })),
          });
        }
      },
      { timeout: 30_000 },
    );

    return resolutions.size;
  }
}

/**
 * An event is late when it became known after a station further along the
 * process had already reported.
 *
 * This is what the platform can actually observe: the sorting record for a
 * batch that is already drying tells us the factory recorded it out of order.
 * Lateness never affects which station a batch counts as being at — that is a
 * maximum over stations reached — it only explains why history changed.
 */
function detectLateArrivals(resolutions: ReadonlyMap<Station, Resolution>): Map<Station, boolean> {
  const lateness = new Map<Station, boolean>();

  for (const [station, resolution] of resolutions) {
    const position = stationIndex(station);

    const isLate = STATION_ORDER.some((laterStation) => {
      if (stationIndex(laterStation) <= position) {
        return false;
      }
      const later = resolutions.get(laterStation);
      return later ? later.winner.observedAt.getTime() < resolution.winner.observedAt.getTime() : false;
    });

    lateness.set(station, isLate);
  }

  return lateness;
}

/** The explanation shown next to an accepted event in the interface. */
function buildResolutionSummary(resolution: Resolution) {
  return {
    rule: resolution.rule,
    candidateCount: resolution.candidateCount,
    hasConflict: resolution.hasConflict,
    acceptedFrom: {
      sourceType: resolution.winner.sourceType,
      sourceRecordId: resolution.winner.sourceRecordId,
    },
    reportedQuantities: resolution.reportedQuantities,
  };
}
