import { Injectable, NotFoundException } from '@nestjs/common';
import { ManagementEventType, type CanonicalEvent, type ManagementEvent } from '@prisma/client';
import {
  computeBatchView,
  computeLineView,
  type BatchInput,
  type BatchStateOptions,
  type BatchView,
} from '../domain/batch-state';
import { STATION_ORDER, stationIndex } from '../domain/stations';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateManagementEventDto, ProductionQueryDto } from '../sources/dto';

/**
 * The production view.
 *
 * Nothing here is stored: batch state, station progress, work in progress and
 * freshness are all recomputed from accepted events and the manager's actions
 * on every read. That costs a little work per request and buys the guarantee
 * that the board can never disagree with the data it is drawn from.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async getLines(query: ProductionQueryDto) {
    const batches = await this.buildBatchViews(query);

    const byLine = new Map<string, BatchView[]>();
    for (const batch of batches) {
      const lineId = batch.lineId ?? 'UNASSIGNED';
      byLine.set(lineId, [...(byLine.get(lineId) ?? []), batch]);
    }

    const lines = [...byLine.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([lineId, lineBatches]) => ({
        ...computeLineView(lineId, lineBatches),
        batches: lineBatches.sort(compareBatchesForDisplay),
      }));

    return {
      staleThresholdMinutes: query.staleThresholdMinutes ?? this.config.staleThresholdMinutes,
      generatedAt: new Date(),
      lines: query.lineId ? lines.filter((line) => line.lineId === query.lineId) : lines,
    };
  }

  /**
   * One batch in full: its state, every station it has and has not reached,
   * and for each accepted event the observations that produced it.
   */
  async getBatch(batchId: string, query: ProductionQueryDto = {}) {
    const [link, events, managementEvents] = await Promise.all([
      this.prisma.batchLink.findUnique({ where: { batchId } }),
      this.prisma.canonicalEvent.findMany({
        where: { batchId },
        include: {
          contributions: {
            include: {
              sourceRecord: {
                select: {
                  id: true,
                  sourceRecordId: true,
                  dataset: true,
                  collectedAt: true,
                  quantity: true,
                  occurredAt: true,
                  collectionRunId: true,
                  payload: true,
                  source: { select: { id: true, name: true, type: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.managementEvent.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } }),
    ]);

    if (!link && events.length === 0) {
      throw new NotFoundException(`batch ${batchId} was not found`);
    }

    const view = computeBatchView(
      this.toBatchInput(batchId, link, events, managementEvents),
      this.optionsFor(query),
    );

    const timeline = [...events]
      .sort((a, b) => stationIndex(a.station) - stationIndex(b.station))
      .map((event) => ({
        station: event.station,
        quantity: event.quantity,
        occurredAt: event.occurredAt,
        observedAt: event.observedAt,
        acceptedAt: event.acceptedAt,
        isLate: event.isLate,
        hasConflict: event.hasConflict,
        resolution: event.resolution,
        // Every observation that fed this event, and how it was treated.
        contributions: event.contributions.map((contribution) => ({
          role: contribution.role,
          reason: contribution.reason,
          record: contribution.sourceRecord,
        })),
      }));

    return {
      ...view,
      linenType: link?.linenType ?? null,
      timeline,
      managementEvents: managementEvents.map(toManagementEventDto),
    };
  }

  /**
   * Appends a manager action. Nothing collected is ever modified: the action is
   * added to the log and the batch's state is re-derived from it on the next
   * read.
   */
  async addManagementEvent(batchId: string, dto: CreateManagementEventDto) {
    const exists =
      (await this.prisma.batchLink.count({ where: { batchId } })) > 0 ||
      (await this.prisma.canonicalEvent.count({ where: { batchId } })) > 0;

    if (!exists) {
      throw new NotFoundException(`batch ${batchId} was not found`);
    }

    const event = await this.prisma.managementEvent.create({
      data: {
        organizationId: this.config.organizationId,
        batchId,
        type: dto.type,
        actor: dto.actor ?? this.config.defaultActor,
        note: dto.note ?? null,
      },
    });

    return toManagementEventDto(event);
  }

  async listManagementEvents(batchId: string) {
    const events = await this.prisma.managementEvent.findMany({
      where: { batchId },
      orderBy: { createdAt: 'desc' },
    });
    return events.map(toManagementEventDto);
  }

  /** Flat batch list, used by the board's batch table and by search. */
  async listBatches(query: ProductionQueryDto) {
    const batches = await this.buildBatchViews(query);
    return {
      staleThresholdMinutes: query.staleThresholdMinutes ?? this.config.staleThresholdMinutes,
      batches: batches.sort(compareBatchesForDisplay),
    };
  }

  private async buildBatchViews(query: ProductionQueryDto): Promise<BatchView[]> {
    const [links, events, managementEvents] = await Promise.all([
      this.prisma.batchLink.findMany(),
      this.prisma.canonicalEvent.findMany(),
      this.prisma.managementEvent.findMany(),
    ]);

    const eventsByBatch = groupBy(events, (event) => event.batchId);
    const actionsByBatch = groupBy(managementEvents, (event) => event.batchId);

    // A batch may be known from the application API, from an operational event,
    // or both. Anything observed anywhere has to appear on the board, otherwise
    // data arriving without a work order would be invisible.
    const batchIds = new Set<string>([
      ...links.map((link) => link.batchId),
      ...events.map((event) => event.batchId),
    ]);

    const linksById = new Map(links.map((link) => [link.batchId, link]));
    const options = this.optionsFor(query);

    const views = [...batchIds].map((batchId) =>
      computeBatchView(
        this.toBatchInput(
          batchId,
          linksById.get(batchId) ?? null,
          eventsByBatch.get(batchId) ?? [],
          actionsByBatch.get(batchId) ?? [],
        ),
        options,
      ),
    );

    return query.lineId ? views.filter((view) => view.lineId === query.lineId) : views;
  }

  private toBatchInput(
    batchId: string,
    link: { workOrderId: string; lineId: string; plannedQuantity: number | null } | null,
    events: readonly CanonicalEvent[],
    managementEvents: readonly ManagementEvent[],
  ): BatchInput {
    return {
      batchId,
      workOrderId: link?.workOrderId ?? null,
      lineId: link?.lineId ?? null,
      plannedQuantity: link?.plannedQuantity ?? null,
      events: events.map((event) => ({
        station: event.station,
        quantity: event.quantity,
        occurredAt: event.occurredAt,
        observedAt: event.observedAt,
        isLate: event.isLate,
        hasConflict: event.hasConflict,
      })),
      managementEvents: managementEvents.map((event) => ({
        id: event.id,
        type: event.type,
        actor: event.actor,
        note: event.note,
        createdAt: event.createdAt,
      })),
    };
  }

  private optionsFor(query: ProductionQueryDto): BatchStateOptions {
    return {
      now: new Date(),
      staleThresholdMinutes: query.staleThresholdMinutes ?? this.config.staleThresholdMinutes,
      quantityTolerance: this.config.quantityTolerance,
    };
  }
}

/** Most urgent first: blocked, then exceptions, then furthest along. */
function compareBatchesForDisplay(a: BatchView, b: BatchView): number {
  const severity = (batch: BatchView) => {
    if (batch.isBlocked) return 0;
    if (batch.indicators.some((indicator) => indicator.severity === 'WARNING')) return 1;
    if (batch.state === 'COMPLETED') return 3;
    return 2;
  };

  const bySeverity = severity(a) - severity(b);
  if (bySeverity !== 0) {
    return bySeverity;
  }

  const byStation =
    (b.currentStation ? stationIndex(b.currentStation) : -1) -
    (a.currentStation ? stationIndex(a.currentStation) : -1);
  if (byStation !== 0) {
    return byStation;
  }

  return a.batchId.localeCompare(b.batchId);
}

function toManagementEventDto(event: ManagementEvent) {
  return {
    id: event.id,
    batchId: event.batchId,
    organizationId: event.organizationId,
    type: event.type,
    actor: event.actor,
    note: event.note,
    createdAt: event.createdAt,
  };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const bucket = grouped.get(key(item));
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(key(item), [item]);
    }
  }
  return grouped;
}

export { ManagementEventType, STATION_ORDER };
