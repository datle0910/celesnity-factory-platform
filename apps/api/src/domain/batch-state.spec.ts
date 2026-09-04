import { ManagementEventType, Station } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  computeBatchView,
  computeLineView,
  type AcceptedEvent,
  type BatchInput,
  type BatchStateOptions,
  type ManagementAction,
} from './batch-state';

const NOW = new Date(Date.UTC(2026, 8, 6, 9, 0, 0));

const at = (minutesAgo: number): Date => new Date(NOW.getTime() - minutesAgo * 60_000);

const options: BatchStateOptions = {
  now: NOW,
  staleThresholdMinutes: 15,
  quantityTolerance: 0.05,
};

function event(station: Station, minutesAgo: number, overrides: Partial<AcceptedEvent> = {}): AcceptedEvent {
  return {
    station,
    quantity: 120,
    occurredAt: at(minutesAgo),
    observedAt: at(minutesAgo),
    isLate: false,
    hasConflict: false,
    ...overrides,
  };
}

function action(type: ManagementEventType, minutesAgo: number, id = `mgmt-${type}-${minutesAgo}`): ManagementAction {
  return { id, type, actor: 'line.manager@celesnity.local', note: null, createdAt: at(minutesAgo) };
}

function batch(overrides: Partial<BatchInput> = {}): BatchInput {
  return {
    batchId: 'B-001',
    workOrderId: 'WO-1001',
    lineId: 'LINE-A',
    plannedQuantity: 120,
    events: [],
    managementEvents: [],
    ...overrides,
  };
}

const indicatorCodes = (view: ReturnType<typeof computeBatchView>) =>
  view.indicators.map((indicator) => indicator.code);

describe('computeBatchView — state', () => {
  it('is PLANNED when a work order exists but nothing has been collected', () => {
    const view = computeBatchView(batch(), options);

    expect(view.state).toBe('PLANNED');
    expect(view.currentStation).toBeNull();
    expect(indicatorCodes(view)).toContain('NO_DATA');
  });

  it('is IN_PROGRESS once any operational event has been accepted', () => {
    const view = computeBatchView(batch({ events: [event(Station.WASHING, 5)] }), options);

    expect(view.state).toBe('IN_PROGRESS');
    expect(view.currentStation).toBe(Station.WASHING);
  });

  it('is COMPLETED once dispatch has been accepted', () => {
    const view = computeBatchView(
      batch({ events: [event(Station.RECEIVING, 100), event(Station.DISPATCH, 10)] }),
      options,
    );

    expect(view.state).toBe('COMPLETED');
  });

  it('is BLOCKED when a manager blocked it and has not resumed', () => {
    const view = computeBatchView(
      batch({
        events: [event(Station.WASHING, 5)],
        managementEvents: [action(ManagementEventType.BLOCK, 3)],
      }),
      options,
    );

    expect(view.state).toBe('BLOCKED');
    expect(view.isBlocked).toBe(true);
    expect(view.blockedSince).toEqual(at(3));
  });

  it('returns to IN_PROGRESS after the block is resumed', () => {
    const view = computeBatchView(
      batch({
        events: [event(Station.WASHING, 5)],
        managementEvents: [action(ManagementEventType.BLOCK, 4), action(ManagementEventType.RESUME, 2)],
      }),
      options,
    );

    expect(view.state).toBe('IN_PROGRESS');
    expect(view.isBlocked).toBe(false);
    expect(view.blockedSince).toBeNull();
  });

  it('ranks COMPLETED above BLOCKED, following the specified evaluation order', () => {
    const view = computeBatchView(
      batch({
        events: [event(Station.DISPATCH, 5)],
        managementEvents: [action(ManagementEventType.BLOCK, 3)],
      }),
      options,
    );

    expect(view.state).toBe('COMPLETED');
    // The block is still recorded; it just does not decide the state.
    expect(view.isBlocked).toBe(true);
  });

  it('replays management events in time order regardless of input order', () => {
    const resumeThenBlock = computeBatchView(
      batch({
        events: [event(Station.WASHING, 5)],
        managementEvents: [action(ManagementEventType.RESUME, 2), action(ManagementEventType.BLOCK, 4)],
      }),
      options,
    );

    expect(resumeThenBlock.state).toBe('IN_PROGRESS');
  });

  it('records an acknowledgement without changing the state', () => {
    const view = computeBatchView(
      batch({
        events: [event(Station.WASHING, 5)],
        managementEvents: [action(ManagementEventType.ACKNOWLEDGE_EXCEPTION, 1)],
      }),
      options,
    );

    expect(view.state).toBe('IN_PROGRESS');
    expect(view.acknowledgedAt).toEqual(at(1));
  });
});

describe('computeBatchView — station progress', () => {
  it('reports the furthest station reached', () => {
    const view = computeBatchView(
      batch({
        events: [event(Station.RECEIVING, 60), event(Station.SORTING, 45), event(Station.DRYING, 9)],
      }),
      options,
    );

    expect(view.currentStation).toBe(Station.DRYING);
  });

  it('does not move backwards when a late event from an earlier station arrives', () => {
    const withoutLateEvent = computeBatchView(
      batch({ events: [event(Station.WASHING, 30), event(Station.DRYING, 9)] }),
      options,
    );

    const withLateEvent = computeBatchView(
      batch({
        events: [
          event(Station.WASHING, 30),
          event(Station.DRYING, 9),
          // Happened before washing, but only became known two minutes ago.
          event(Station.SORTING, 45, { observedAt: at(2), isLate: true }),
        ],
      }),
      options,
    );

    expect(withoutLateEvent.currentStation).toBe(Station.DRYING);
    expect(withLateEvent.currentStation).toBe(Station.DRYING);
    expect(indicatorCodes(withLateEvent)).toContain('LATE_EVENT');
  });

  it('closes the missing-data gap once the late event fills it', () => {
    const before = computeBatchView(
      batch({ events: [event(Station.RECEIVING, 60), event(Station.WASHING, 30), event(Station.DRYING, 9)] }),
      options,
    );
    const after = computeBatchView(
      batch({
        events: [
          event(Station.RECEIVING, 60),
          event(Station.SORTING, 45, { observedAt: at(2), isLate: true }),
          event(Station.WASHING, 30),
          event(Station.DRYING, 9),
        ],
      }),
      options,
    );

    expect(before.missingStations).toEqual([Station.SORTING]);
    expect(after.missingStations).toEqual([]);
  });

  it('flags missing data when a later station reports without the earlier ones', () => {
    const view = computeBatchView(batch({ events: [event(Station.WASHING, 7, { quantity: 60 })] }), options);

    expect(view.state).toBe('IN_PROGRESS');
    expect(view.currentStation).toBe(Station.WASHING);
    expect(view.missingStations).toEqual([Station.RECEIVING, Station.SORTING]);
    expect(indicatorCodes(view)).toContain('MISSING_DATA');
  });

  it('reports the completed quantity at the current station', () => {
    const view = computeBatchView(
      batch({
        events: [event(Station.RECEIVING, 60, { quantity: 120 }), event(Station.DRYING, 9, { quantity: 118 })],
      }),
      options,
    );

    expect(view.completedQuantity).toBe(118);
  });
});

describe('computeBatchView — freshness', () => {
  it('is fresh while events keep arriving inside the threshold', () => {
    const view = computeBatchView(batch({ events: [event(Station.WASHING, 5)] }), options);

    expect(view.isStale).toBe(false);
    expect(view.ageMinutes).toBe(5);
  });

  it('becomes stale past the configured threshold', () => {
    const view = computeBatchView(batch({ events: [event(Station.SORTING, 95)] }), options);

    expect(view.isStale).toBe(true);
    expect(indicatorCodes(view)).toContain('STALE');
  });

  it('honours a different threshold', () => {
    const view = computeBatchView(batch({ events: [event(Station.SORTING, 30)] }), {
      ...options,
      staleThresholdMinutes: 45,
    });

    expect(view.isStale).toBe(false);
  });

  it('does not call a completed batch stale', () => {
    const view = computeBatchView(
      batch({ events: [event(Station.DISPATCH, 240)] }),
      options,
    );

    expect(view.state).toBe('COMPLETED');
    expect(view.isStale).toBe(false);
  });
});

describe('computeBatchView — quality indicators', () => {
  it('flags a station quantity that deviates from the received quantity', () => {
    const view = computeBatchView(
      batch({
        plannedQuantity: 150,
        events: [
          event(Station.RECEIVING, 80, { quantity: 150 }),
          event(Station.DRYING, 6, { quantity: 120 }),
        ],
      }),
      options,
    );

    const mismatch = view.indicators.find((indicator) => indicator.code === 'QUANTITY_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch?.detail).toMatchObject({ station: Station.DRYING, reported: 120, reference: 150 });
  });

  it('tolerates a small shortfall', () => {
    const view = computeBatchView(
      batch({
        events: [event(Station.RECEIVING, 80, { quantity: 120 }), event(Station.DRYING, 6, { quantity: 118 })],
      }),
      options,
    );

    expect(indicatorCodes(view)).not.toContain('QUANTITY_MISMATCH');
  });

  it('surfaces a source disagreement recorded during normalisation', () => {
    const view = computeBatchView(
      batch({ events: [event(Station.RECEIVING, 80, { hasConflict: true })] }),
      options,
    );

    expect(indicatorCodes(view)).toContain('CONFLICTING_SOURCES');
  });
});

describe('computeLineView', () => {
  const washingBatch = computeBatchView(
    batch({ batchId: 'B-004', events: [event(Station.WASHING, 10, { quantity: 75 })] }),
    options,
  );
  const dryingBatch = computeBatchView(
    batch({ batchId: 'B-003', events: [event(Station.DRYING, 6, { quantity: 120 })] }),
    options,
  );
  const anotherWashingBatch = computeBatchView(
    batch({ batchId: 'B-007', events: [event(Station.WASHING, 7, { quantity: 60 })] }),
    options,
  );
  const completedBatch = computeBatchView(
    batch({
      batchId: 'B-001',
      events: [event(Station.WASHING, 90, { quantity: 120 }), event(Station.DISPATCH, 40, { quantity: 118 })],
    }),
    options,
  );

  const line = computeLineView('LINE-A', [washingBatch, dryingBatch, anotherWashingBatch, completedBatch]);

  const stationSummary = (station: Station) => line.stations.find((entry) => entry.station === station)!;

  it('counts work in progress per station', () => {
    expect(stationSummary(Station.WASHING).wip).toBe(2);
    expect(stationSummary(Station.DRYING).wip).toBe(1);
  });

  it('excludes completed batches from work in progress', () => {
    expect(stationSummary(Station.WASHING).batchIds).toEqual(['B-004', 'B-007']);
    expect(stationSummary(Station.DISPATCH).wip).toBe(0);
  });

  it('totals the quantity that passed through each station', () => {
    // 120 from the completed batch plus 75 and 60 still washing.
    expect(stationSummary(Station.WASHING).completedQuantity).toBe(255);
  });

  it('reports every station, including ones nothing has reached', () => {
    expect(line.stations).toHaveLength(6);
    expect(stationSummary(Station.RECEIVING).wip).toBe(0);
  });

  it('summarises the line', () => {
    expect(line.batchCount).toBe(4);
    expect(line.completedCount).toBe(1);
    expect(line.workOrderIds).toEqual(['WO-1001']);
  });
});
