import { ContributionRole, SourceType, Station } from '@prisma/client';
import { authorityRank } from './stations';

/**
 * Deterministic deduplication and conflict handling.
 *
 * Every observation the platform has ever collected for one batch and one
 * station is passed in; exactly one is accepted and the rest are classified.
 * The function is pure and total: the same input always yields the same winner,
 * with no dependence on insertion order, wall-clock time or database ordering.
 *
 * Two distinct problems are handled in sequence, because they have different
 * answers:
 *
 *   1. The same observation collected more than once — the crawler re-rendering
 *      a delivery row on two pages, or a second collection run re-reading rows
 *      it has already seen. These are not new information. They collapse to one
 *      observation so a quantity is never counted twice.
 *
 *   2. Different sources genuinely disagreeing about the same event — the
 *      supplier portal and the internal application both reporting a receiving
 *      quantity, and reporting different numbers. One has to be accepted; the
 *      other is retained, marked superseded, and the disagreement is flagged
 *      rather than averaged away.
 */

export interface Observation {
  /** SourceRecord primary key. */
  recordId: string;
  sourceId: string;
  sourceType: SourceType;
  /** Stable identifier issued by the source system. */
  sourceRecordId: string;
  quantity: number | null;
  /** When the event happened on the factory floor. */
  occurredAt: Date;
  /**
   * When the platform became aware of it: the source's own recorded-at where
   * it exposes one, otherwise when the row was collected.
   */
  observedAt: Date;
}

export type ResolutionRule =
  | 'SINGLE_OBSERVATION'
  | 'AUTHORITATIVE_SOURCE'
  | 'EARLIEST_OCCURRED_AT'
  | 'LOWEST_SOURCE_RECORD_ID';

export interface Contribution {
  recordId: string;
  role: ContributionRole;
  reason: string;
}

export interface Resolution {
  winner: Observation;
  contributions: Contribution[];
  rule: ResolutionRule;
  /** Two or more distinct sources reported different quantities. */
  hasConflict: boolean;
  /** Distinct observations considered after duplicates were collapsed. */
  candidateCount: number;
  /** Quantities per source type, retained so the interface can show the disagreement. */
  reportedQuantities: { sourceType: SourceType; sourceRecordId: string; quantity: number | null }[];
}

const identityOf = (observation: Observation): string =>
  `${observation.sourceId}::${observation.sourceRecordId}`;

/**
 * Total ordering over observations. Every tier is a total order on its own key
 * and the final tier is a primary key, so no two distinct observations can ever
 * compare equal. That is what makes the winner independent of input order.
 */
function compareCandidates(station: Station, a: Observation, b: Observation): number {
  const byAuthority = authorityRank(station, a.sourceType) - authorityRank(station, b.sourceType);
  if (byAuthority !== 0) {
    return byAuthority;
  }

  const byOccurredAt = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byOccurredAt !== 0) {
    return byOccurredAt;
  }

  const bySourceRecordId = a.sourceRecordId.localeCompare(b.sourceRecordId);
  if (bySourceRecordId !== 0) {
    return bySourceRecordId;
  }

  return a.recordId.localeCompare(b.recordId);
}

/** Which criterion actually separated the winner from the runner-up. */
function decidingRule(station: Station, winner: Observation, runnerUp: Observation): ResolutionRule {
  if (authorityRank(station, winner.sourceType) !== authorityRank(station, runnerUp.sourceType)) {
    return 'AUTHORITATIVE_SOURCE';
  }
  if (winner.occurredAt.getTime() !== runnerUp.occurredAt.getTime()) {
    return 'EARLIEST_OCCURRED_AT';
  }
  return 'LOWEST_SOURCE_RECORD_ID';
}

function describeRule(rule: ResolutionRule, station: Station, winner: Observation): string {
  switch (rule) {
    case 'SINGLE_OBSERVATION':
      return 'only observation available for this station';
    case 'AUTHORITATIVE_SOURCE':
      return `${winner.sourceType} is the authoritative source for ${station}`;
    case 'EARLIEST_OCCURRED_AT':
      return 'equally authoritative sources, earliest occurrence accepted';
    case 'LOWEST_SOURCE_RECORD_ID':
      return 'equally authoritative and simultaneous, lowest source record id accepted';
  }
}

/**
 * @returns null when there is nothing to accept, so callers can treat "no
 *          observations" and "no canonical event" as the same thing.
 */
export function resolveObservations(
  station: Station,
  observations: readonly Observation[],
): Resolution | null {
  if (observations.length === 0) {
    return null;
  }

  const contributions: Contribution[] = [];

  // --- Step 1: collapse repeat deliveries of the same observation -----------
  const byIdentity = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = identityOf(observation);
    const bucket = byIdentity.get(key);
    if (bucket) {
      bucket.push(observation);
    } else {
      byIdentity.set(key, [observation]);
    }
  }

  const candidates: Observation[] = [];
  for (const bucket of byIdentity.values()) {
    // Earliest sighting wins; the record id breaks a simultaneous tie so the
    // choice does not depend on the order rows came back from the database.
    const ordered = [...bucket].sort(
      (a, b) => a.observedAt.getTime() - b.observedAt.getTime() || a.recordId.localeCompare(b.recordId),
    );
    const [kept, ...repeats] = ordered;
    candidates.push(kept);

    for (const repeat of repeats) {
      contributions.push({
        recordId: repeat.recordId,
        role: ContributionRole.DUPLICATE,
        reason: `repeat delivery of ${repeat.sourceRecordId}, already accepted from the same source`,
      });
    }
  }

  // --- Step 2: resolve genuine disagreement between sources ----------------
  const ranked = [...candidates].sort((a, b) => compareCandidates(station, a, b));
  const [winner, ...losers] = ranked;

  const rule: ResolutionRule =
    ranked.length === 1 ? 'SINGLE_OBSERVATION' : decidingRule(station, winner, ranked[1]);

  contributions.push({
    recordId: winner.recordId,
    role: ContributionRole.WINNER,
    reason: describeRule(rule, station, winner),
  });

  for (const loser of losers) {
    contributions.push({
      recordId: loser.recordId,
      role: ContributionRole.SUPERSEDED,
      reason: `superseded by ${winner.sourceType} observation ${winner.sourceRecordId}`,
    });
  }

  const distinctQuantities = new Set(
    candidates.map((candidate) => candidate.quantity).filter((quantity): quantity is number => quantity !== null),
  );

  return {
    winner,
    contributions,
    rule,
    hasConflict: candidates.length > 1 && distinctQuantities.size > 1,
    candidateCount: candidates.length,
    reportedQuantities: candidates.map((candidate) => ({
      sourceType: candidate.sourceType,
      sourceRecordId: candidate.sourceRecordId,
      quantity: candidate.quantity,
    })),
  };
}
