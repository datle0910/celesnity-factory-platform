import { ContributionRole, SourceType, Station } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { resolveObservations, type Observation } from './dedup';

const at = (minutesAgo: number): Date => new Date(Date.UTC(2026, 8, 6, 9, 0, 0) - minutesAgo * 60_000);

function observation(overrides: Partial<Observation> & Pick<Observation, 'recordId'>): Observation {
  return {
    sourceId: 'src-crawler',
    sourceType: SourceType.CRAWLER,
    sourceRecordId: `SPR-${overrides.recordId}`,
    quantity: 120,
    occurredAt: at(120),
    observedAt: at(10),
    ...overrides,
  };
}

const roleOf = (result: NonNullable<ReturnType<typeof resolveObservations>>, recordId: string) =>
  result.contributions.find((contribution) => contribution.recordId === recordId)?.role;

describe('resolveObservations', () => {
  it('returns null when there is nothing to accept', () => {
    expect(resolveObservations(Station.RECEIVING, [])).toBeNull();
  });

  it('accepts a lone observation', () => {
    const only = observation({ recordId: 'r1' });

    const result = resolveObservations(Station.RECEIVING, [only]);

    expect(result?.winner.recordId).toBe('r1');
    expect(result?.rule).toBe('SINGLE_OBSERVATION');
    expect(result?.candidateCount).toBe(1);
    expect(result?.hasConflict).toBe(false);
    expect(roleOf(result!, 'r1')).toBe(ContributionRole.WINNER);
  });

  describe('repeat deliveries of one observation', () => {
    // The supplier portal renders the same delivery row on two pages. Both
    // carry the same stable id, so this is one observation seen twice.
    const first = observation({ recordId: 'r1', sourceRecordId: 'SPR-000001', observedAt: at(10) });
    const repeat = observation({ recordId: 'r2', sourceRecordId: 'SPR-000001', observedAt: at(4) });

    it('collapses them to a single candidate and keeps the earliest sighting', () => {
      const result = resolveObservations(Station.RECEIVING, [first, repeat]);

      expect(result?.candidateCount).toBe(1);
      expect(result?.winner.recordId).toBe('r1');
      expect(roleOf(result!, 'r2')).toBe(ContributionRole.DUPLICATE);
    });

    it('does not report a conflict, because nothing actually disagrees', () => {
      const result = resolveObservations(Station.RECEIVING, [first, repeat]);

      expect(result?.hasConflict).toBe(false);
      expect(result?.reportedQuantities).toHaveLength(1);
    });

    it('retains the repeat as a contribution so the audit trail stays complete', () => {
      const result = resolveObservations(Station.RECEIVING, [first, repeat]);

      expect(result?.contributions.map((contribution) => contribution.recordId).sort()).toEqual(['r1', 'r2']);
    });
  });

  describe('two sources disagreeing about the same event', () => {
    // The supplier portal says 120, the internal application says 125.
    const fromCrawler = observation({
      recordId: 'r-crawler',
      sourceId: 'src-crawler',
      sourceType: SourceType.CRAWLER,
      sourceRecordId: 'SPR-000001',
      quantity: 120,
    });
    const fromAppApi = observation({
      recordId: 'r-app',
      sourceId: 'src-app',
      sourceType: SourceType.APPLICATION_API,
      sourceRecordId: 'AR-001',
      quantity: 125,
    });

    it('accepts the source that is authoritative for the station', () => {
      const result = resolveObservations(Station.RECEIVING, [fromAppApi, fromCrawler]);

      expect(result?.winner.recordId).toBe('r-crawler');
      expect(result?.rule).toBe('AUTHORITATIVE_SOURCE');
      expect(roleOf(result!, 'r-app')).toBe(ContributionRole.SUPERSEDED);
    });

    it('flags the disagreement instead of silently discarding it', () => {
      const result = resolveObservations(Station.RECEIVING, [fromAppApi, fromCrawler]);

      expect(result?.hasConflict).toBe(true);
      expect(result?.reportedQuantities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceType: SourceType.CRAWLER, quantity: 120 }),
          expect.objectContaining({ sourceType: SourceType.APPLICATION_API, quantity: 125 }),
        ]),
      );
    });

    it('reverses the precedence at dispatch, where the application is authoritative', () => {
      const dispatchFromApp = observation({
        recordId: 'r-app',
        sourceId: 'src-app',
        sourceType: SourceType.APPLICATION_API,
        sourceRecordId: 'AD-001',
        quantity: 118,
      });
      const dispatchFromDb = observation({
        recordId: 'r-db',
        sourceId: 'src-db',
        sourceType: SourceType.DATABASE,
        sourceRecordId: 'PE-DSP-001',
        quantity: 118,
      });

      const result = resolveObservations(Station.DISPATCH, [dispatchFromDb, dispatchFromApp]);

      expect(result?.winner.recordId).toBe('r-app');
      expect(result?.rule).toBe('AUTHORITATIVE_SOURCE');
    });

    it('does not flag a conflict when the sources agree on the quantity', () => {
      const result = resolveObservations(Station.DISPATCH, [
        observation({ recordId: 'r-db', sourceId: 'src-db', sourceType: SourceType.DATABASE, quantity: 118 }),
        observation({ recordId: 'r-app', sourceId: 'src-app', sourceType: SourceType.APPLICATION_API, quantity: 118 }),
      ]);

      expect(result?.hasConflict).toBe(false);
    });

    it('ranks machine telemetry below the factory system of record', () => {
      const result = resolveObservations(Station.WASHING, [
        observation({ recordId: 'r-mqtt', sourceId: 'src-mqtt', sourceType: SourceType.MQTT, quantity: 75 }),
        observation({ recordId: 'r-db', sourceId: 'src-db', sourceType: SourceType.DATABASE, quantity: 75 }),
      ]);

      expect(result?.winner.recordId).toBe('r-db');
    });
  });

  describe('tie-breaking between equally authoritative observations', () => {
    it('prefers the earliest occurrence', () => {
      const later = observation({
        recordId: 'r-later',
        sourceId: 'src-db-a',
        sourceType: SourceType.DATABASE,
        sourceRecordId: 'PE-A',
        occurredAt: at(30),
      });
      const earlier = observation({
        recordId: 'r-earlier',
        sourceId: 'src-db-b',
        sourceType: SourceType.DATABASE,
        sourceRecordId: 'PE-B',
        occurredAt: at(60),
      });

      const result = resolveObservations(Station.SORTING, [later, earlier]);

      expect(result?.winner.recordId).toBe('r-earlier');
      expect(result?.rule).toBe('EARLIEST_OCCURRED_AT');
    });

    it('falls back to the lowest source record id when everything else is equal', () => {
      const zulu = observation({
        recordId: 'r-z',
        sourceId: 'src-db-a',
        sourceType: SourceType.DATABASE,
        sourceRecordId: 'PE-Z',
      });
      const alpha = observation({
        recordId: 'r-a',
        sourceId: 'src-db-b',
        sourceType: SourceType.DATABASE,
        sourceRecordId: 'PE-A',
      });

      const result = resolveObservations(Station.SORTING, [zulu, alpha]);

      expect(result?.winner.recordId).toBe('r-a');
      expect(result?.rule).toBe('LOWEST_SOURCE_RECORD_ID');
    });
  });

  it('is independent of the order the observations arrive in', () => {
    const observations = [
      observation({ recordId: 'r1', sourceId: 'src-crawler', sourceType: SourceType.CRAWLER, sourceRecordId: 'SPR-1', quantity: 120 }),
      observation({ recordId: 'r2', sourceId: 'src-crawler', sourceType: SourceType.CRAWLER, sourceRecordId: 'SPR-1', quantity: 120, observedAt: at(2) }),
      observation({ recordId: 'r3', sourceId: 'src-app', sourceType: SourceType.APPLICATION_API, sourceRecordId: 'AR-1', quantity: 125 }),
      observation({ recordId: 'r4', sourceId: 'src-db', sourceType: SourceType.DATABASE, sourceRecordId: 'PE-1', quantity: 121 }),
    ];

    const permutations = [
      observations,
      [...observations].reverse(),
      [observations[2], observations[0], observations[3], observations[1]],
      [observations[3], observations[1], observations[2], observations[0]],
    ];

    const outcomes = permutations.map((permutation) => {
      const result = resolveObservations(Station.RECEIVING, permutation)!;
      return {
        winner: result.winner.recordId,
        rule: result.rule,
        candidateCount: result.candidateCount,
        hasConflict: result.hasConflict,
        roles: [...result.contributions]
          .sort((a, b) => a.recordId.localeCompare(b.recordId))
          .map((contribution) => `${contribution.recordId}:${contribution.role}`),
      };
    });

    for (const outcome of outcomes) {
      expect(outcome).toEqual(outcomes[0]);
    }
    expect(outcomes[0].winner).toBe('r1');
    expect(outcomes[0].candidateCount).toBe(3);
  });

  it('never counts a repeated observation twice in the reported quantities', () => {
    const result = resolveObservations(Station.RECEIVING, [
      observation({ recordId: 'r1', sourceRecordId: 'SPR-000001', quantity: 120 }),
      observation({ recordId: 'r2', sourceRecordId: 'SPR-000001', quantity: 120 }),
      observation({ recordId: 'r3', sourceRecordId: 'SPR-000001', quantity: 120 }),
    ]);

    expect(result?.reportedQuantities).toHaveLength(1);
    expect(result?.winner.quantity).toBe(120);
  });
});
