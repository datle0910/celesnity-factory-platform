import { ManagementEventType, Station } from '@prisma/client';
import { STATION_ORDER, stationIndex, stationsBefore } from './stations';

/**
 * Derivation of batch state, station progress, work in progress and freshness.
 *
 * Nothing here is stored. Given the accepted events and the manager's actions,
 * the same inputs always produce the same view, which keeps collected history
 * and interpretation of that history strictly separate.
 */

export type BatchState = 'COMPLETED' | 'BLOCKED' | 'IN_PROGRESS' | 'PLANNED';

export type IndicatorCode =
  | 'BLOCKED'
  | 'STALE'
  | 'MISSING_DATA'
  | 'QUANTITY_MISMATCH'
  | 'CONFLICTING_SOURCES'
  | 'LATE_EVENT'
  | 'NO_DATA';

export type IndicatorSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Indicator {
  code: IndicatorCode;
  severity: IndicatorSeverity;
  message: string;
  detail?: Record<string, unknown>;
}

export interface AcceptedEvent {
  station: Station;
  quantity: number | null;
  occurredAt: Date;
  observedAt: Date;
  isLate: boolean;
  hasConflict: boolean;
}

export interface ManagementAction {
  id: string;
  type: ManagementEventType;
  actor: string;
  note: string | null;
  createdAt: Date;
}

export interface BatchInput {
  batchId: string;
  workOrderId: string | null;
  lineId: string | null;
  plannedQuantity: number | null;
  events: readonly AcceptedEvent[];
  managementEvents: readonly ManagementAction[];
}

export interface BatchStateOptions {
  now: Date;
  staleThresholdMinutes: number;
  /** Fractional deviation from the reference quantity that is tolerated. */
  quantityTolerance: number;
}

export interface StationProgress {
  station: Station;
  reached: boolean;
  quantity: number | null;
  occurredAt: Date | null;
  isLate: boolean;
  hasConflict: boolean;
}

export interface BatchView {
  batchId: string;
  workOrderId: string | null;
  lineId: string | null;
  plannedQuantity: number | null;
  state: BatchState;
  currentStation: Station | null;
  /** Quantity reported at the current station, after deduplication. */
  completedQuantity: number | null;
  stations: StationProgress[];
  missingStations: Station[];
  lastEventAt: Date | null;
  ageMinutes: number | null;
  isStale: boolean;
  isBlocked: boolean;
  blockedSince: Date | null;
  acknowledgedAt: Date | null;
  indicators: Indicator[];
}

const MS_PER_MINUTE = 60_000;

/**
 * Replays the manager's actions in order. Blocking and resuming are the only
 * actions that change state; acknowledgements and notes are recorded without
 * altering it.
 */
function resolveBlock(actions: readonly ManagementAction[]): {
  isBlocked: boolean;
  blockedSince: Date | null;
  acknowledgedAt: Date | null;
} {
  const ordered = [...actions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  let isBlocked = false;
  let blockedSince: Date | null = null;
  let acknowledgedAt: Date | null = null;

  for (const action of ordered) {
    switch (action.type) {
      case ManagementEventType.BLOCK:
        isBlocked = true;
        blockedSince = action.createdAt;
        break;
      case ManagementEventType.RESUME:
        isBlocked = false;
        blockedSince = null;
        break;
      case ManagementEventType.ACKNOWLEDGE_EXCEPTION:
        acknowledgedAt = action.createdAt;
        break;
      case ManagementEventType.NOTE:
        break;
    }
  }

  return { isBlocked, blockedSince, acknowledgedAt };
}

export function computeBatchView(input: BatchInput, options: BatchStateOptions): BatchView {
  const eventsByStation = new Map<Station, AcceptedEvent>();
  for (const event of input.events) {
    // The caller supplies at most one accepted event per station; the guard
    // keeps the furthest-progressed one if that ever stops being true.
    const existing = eventsByStation.get(event.station);
    if (!existing || event.occurredAt.getTime() > existing.occurredAt.getTime()) {
      eventsByStation.set(event.station, event);
    }
  }

  const { isBlocked, blockedSince, acknowledgedAt } = resolveBlock(input.managementEvents);
  const dispatchEvent = eventsByStation.get(Station.DISPATCH);

  // Furthest station reached. Because this is a maximum over accepted events, a
  // late event from an earlier station enriches history without ever moving the
  // batch backwards.
  let currentStation: Station | null = null;
  for (const station of STATION_ORDER) {
    if (eventsByStation.has(station)) {
      currentStation = station;
    }
  }

  const operationalStations = STATION_ORDER.filter((station) => station !== Station.DISPATCH);
  const hasOperationalEvent = operationalStations.some((station) => eventsByStation.has(station));

  // Evaluated strictly in the order the specification defines.
  let state: BatchState;
  if (dispatchEvent) {
    state = 'COMPLETED';
  } else if (isBlocked) {
    state = 'BLOCKED';
  } else if (hasOperationalEvent) {
    state = 'IN_PROGRESS';
  } else {
    state = 'PLANNED';
  }

  const stations: StationProgress[] = STATION_ORDER.map((station) => {
    const event = eventsByStation.get(station);
    return {
      station,
      reached: Boolean(event),
      quantity: event?.quantity ?? null,
      occurredAt: event?.occurredAt ?? null,
      isLate: event?.isLate ?? false,
      hasConflict: event?.hasConflict ?? false,
    };
  });

  const missingStations = currentStation
    ? stationsBefore(currentStation).filter((station) => !eventsByStation.has(station))
    : [];

  const lastEventAt = input.events.reduce<Date | null>((latest, event) => {
    if (!latest || event.occurredAt.getTime() > latest.getTime()) {
      return event.occurredAt;
    }
    return latest;
  }, null);

  const ageMinutes =
    lastEventAt === null ? null : (options.now.getTime() - lastEventAt.getTime()) / MS_PER_MINUTE;

  // A completed batch is not stale, it is finished. Freshness only signals that
  // a batch still moving through the line has stopped reporting.
  const isStale =
    ageMinutes !== null && state !== 'COMPLETED' && ageMinutes > options.staleThresholdMinutes;

  const indicators = buildIndicators({
    input,
    state,
    stations,
    missingStations,
    isBlocked,
    blockedSince,
    isStale,
    ageMinutes,
    lastEventAt,
    options,
    receivingQuantity: eventsByStation.get(Station.RECEIVING)?.quantity ?? null,
  });

  return {
    batchId: input.batchId,
    workOrderId: input.workOrderId,
    lineId: input.lineId,
    plannedQuantity: input.plannedQuantity,
    state,
    currentStation,
    completedQuantity: currentStation ? (eventsByStation.get(currentStation)?.quantity ?? null) : null,
    stations,
    missingStations,
    lastEventAt,
    ageMinutes,
    isStale,
    isBlocked,
    blockedSince,
    acknowledgedAt,
    indicators,
  };
}

function buildIndicators(args: {
  input: BatchInput;
  state: BatchState;
  stations: StationProgress[];
  missingStations: Station[];
  isBlocked: boolean;
  blockedSince: Date | null;
  isStale: boolean;
  ageMinutes: number | null;
  lastEventAt: Date | null;
  options: BatchStateOptions;
  receivingQuantity: number | null;
}): Indicator[] {
  const indicators: Indicator[] = [];

  if (args.isBlocked) {
    indicators.push({
      code: 'BLOCKED',
      severity: 'CRITICAL',
      message: 'A manager has blocked this batch and has not resumed it.',
      detail: { blockedSince: args.blockedSince?.toISOString() ?? null },
    });
  }

  if (args.missingStations.length > 0) {
    indicators.push({
      code: 'MISSING_DATA',
      severity: 'WARNING',
      message: `Reached a later station without data for ${args.missingStations.join(', ')}.`,
      detail: { missingStations: args.missingStations },
    });
  }

  if (args.isStale && args.ageMinutes !== null) {
    indicators.push({
      code: 'STALE',
      severity: 'WARNING',
      message: `No new event for ${Math.floor(args.ageMinutes)} minutes, over the ${args.options.staleThresholdMinutes} minute threshold.`,
      detail: {
        ageMinutes: Math.floor(args.ageMinutes),
        thresholdMinutes: args.options.staleThresholdMinutes,
        lastEventAt: args.lastEventAt?.toISOString() ?? null,
      },
    });
  }

  if (args.lastEventAt === null && args.state === 'PLANNED') {
    indicators.push({
      code: 'NO_DATA',
      severity: 'INFO',
      message: 'Planned, but no operational event has been collected yet.',
    });
  }

  // The received quantity is the yardstick for everything downstream; the
  // planned quantity stands in when nothing has been received yet.
  const reference = args.receivingQuantity ?? args.input.plannedQuantity;
  if (reference !== null && reference > 0) {
    for (const station of args.stations) {
      if (!station.reached || station.quantity === null || station.station === Station.RECEIVING) {
        continue;
      }
      const deviation = Math.abs(station.quantity - reference) / reference;
      if (deviation > args.options.quantityTolerance) {
        indicators.push({
          code: 'QUANTITY_MISMATCH',
          severity: 'WARNING',
          message: `${station.station} reported ${station.quantity} against a reference of ${reference}.`,
          detail: {
            station: station.station,
            reported: station.quantity,
            reference,
            deviation: Number(deviation.toFixed(4)),
            tolerance: args.options.quantityTolerance,
          },
        });
      }
    }
  }

  const conflicting = args.stations.filter((station) => station.hasConflict).map((station) => station.station);
  if (conflicting.length > 0) {
    indicators.push({
      code: 'CONFLICTING_SOURCES',
      severity: 'WARNING',
      message: `Sources disagreed on the quantity at ${conflicting.join(', ')}.`,
      detail: { stations: conflicting },
    });
  }

  const late = args.stations.filter((station) => station.isLate).map((station) => station.station);
  if (late.length > 0) {
    indicators.push({
      code: 'LATE_EVENT',
      severity: 'INFO',
      message: `Data for ${late.join(', ')} arrived after a later station had already reported.`,
      detail: { stations: late },
    });
  }

  return indicators;
}

export interface StationSummary {
  station: Station;
  /** Non-completed batches whose current station is this one. */
  wip: number;
  batchIds: string[];
  completedQuantity: number;
  lastEventAt: Date | null;
  staleCount: number;
  blockedCount: number;
  missingDataCount: number;
}

export interface LineView {
  lineId: string;
  workOrderIds: string[];
  batchCount: number;
  stations: StationSummary[];
  lastEventAt: Date | null;
  staleCount: number;
  blockedCount: number;
  completedCount: number;
}

export function computeLineView(lineId: string, batches: readonly BatchView[]): LineView {
  const stations: StationSummary[] = STATION_ORDER.map((station) => {
    // Work in progress counts batches sitting at a station, so completed
    // batches are excluded even though they passed through it.
    const atStation = batches.filter(
      (batch) => batch.currentStation === station && batch.state !== 'COMPLETED',
    );

    const reachedStation = batches
      .map((batch) => batch.stations.find((entry) => entry.station === station))
      .filter((entry): entry is StationProgress => Boolean(entry?.reached));

    const lastEventAt = reachedStation.reduce<Date | null>((latest, entry) => {
      if (entry.occurredAt && (!latest || entry.occurredAt.getTime() > latest.getTime())) {
        return entry.occurredAt;
      }
      return latest;
    }, null);

    return {
      station,
      wip: atStation.length,
      batchIds: atStation.map((batch) => batch.batchId),
      completedQuantity: reachedStation.reduce((total, entry) => total + (entry.quantity ?? 0), 0),
      lastEventAt,
      staleCount: atStation.filter((batch) => batch.isStale).length,
      blockedCount: atStation.filter((batch) => batch.isBlocked).length,
      missingDataCount: atStation.filter((batch) => batch.missingStations.length > 0).length,
    };
  });

  const workOrderIds = [
    ...new Set(batches.map((batch) => batch.workOrderId).filter((id): id is string => Boolean(id))),
  ].sort();

  const lastEventAt = batches.reduce<Date | null>((latest, batch) => {
    if (batch.lastEventAt && (!latest || batch.lastEventAt.getTime() > latest.getTime())) {
      return batch.lastEventAt;
    }
    return latest;
  }, null);

  return {
    lineId,
    workOrderIds,
    batchCount: batches.length,
    stations,
    lastEventAt,
    staleCount: batches.filter((batch) => batch.isStale).length,
    blockedCount: batches.filter((batch) => batch.isBlocked).length,
    completedCount: batches.filter((batch) => batch.state === 'COMPLETED').length,
  };
}

export function stationOrderIndex(station: Station): number {
  return stationIndex(station);
}
