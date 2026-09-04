import { SourceType, Station } from '@prisma/client';

/**
 * The six fixed steps, in process order. Everything that reasons about
 * "furthest station reached" or "an earlier station" derives from this array,
 * so the order is defined exactly once.
 */
export const STATION_ORDER: readonly Station[] = [
  Station.RECEIVING,
  Station.SORTING,
  Station.WASHING,
  Station.DRYING,
  Station.FOLDING,
  Station.DISPATCH,
] as const;

/** Position of a station in the process, 0-based. */
export function stationIndex(station: Station): number {
  return STATION_ORDER.indexOf(station);
}

/** Stations strictly before the given one. */
export function stationsBefore(station: Station): Station[] {
  return STATION_ORDER.slice(0, stationIndex(station));
}

/**
 * Which source is authoritative for each station, most authoritative first.
 *
 * This encodes the assessment's required-source matrix. Where a station names a
 * single required source, that source wins any disagreement. Two cases need a
 * judgement call, both documented in the README:
 *
 *   DISPATCH  is allowed to come from either the application API or the
 *             production database. The application API is the system that
 *             actually closes out a dispatch, so it is ranked first and the
 *             database observation is treated as corroboration.
 *   WASHING / DRYING may also carry MQTT telemetry. Telemetry is ranked below
 *             the production database: it is machine-level evidence that a
 *             batch is being processed, not the factory's record of what was
 *             completed.
 *
 * A source type absent from a station's list ranks after every listed one, so
 * an unexpected source never silently outranks a required one.
 */
export const STATION_AUTHORITY: Readonly<Record<Station, readonly SourceType[]>> = {
  [Station.RECEIVING]: [SourceType.CRAWLER, SourceType.APPLICATION_API, SourceType.DATABASE],
  [Station.SORTING]: [SourceType.DATABASE, SourceType.APPLICATION_API],
  [Station.WASHING]: [SourceType.DATABASE, SourceType.MQTT, SourceType.APPLICATION_API],
  [Station.DRYING]: [SourceType.DATABASE, SourceType.MQTT, SourceType.APPLICATION_API],
  [Station.FOLDING]: [SourceType.DATABASE, SourceType.APPLICATION_API],
  [Station.DISPATCH]: [SourceType.APPLICATION_API, SourceType.DATABASE],
};

/** Lower is more authoritative. Unlisted source types rank last. */
export function authorityRank(station: Station, sourceType: SourceType): number {
  const ranking = STATION_AUTHORITY[station];
  const rank = ranking.indexOf(sourceType);
  return rank === -1 ? ranking.length : rank;
}

/**
 * Maps the free-text station labels used by external systems onto the canonical
 * enum. Sources are not obliged to speak the platform's vocabulary: the
 * production database says "ironing and folding", MQTT says "washing".
 */
const STATION_ALIASES: Readonly<Record<string, Station>> = {
  receiving: Station.RECEIVING,
  receipt: Station.RECEIVING,
  goods_in: Station.RECEIVING,
  delivery: Station.RECEIVING,
  sorting: Station.SORTING,
  sort: Station.SORTING,
  washing: Station.WASHING,
  wash: Station.WASHING,
  drying: Station.DRYING,
  dry: Station.DRYING,
  folding: Station.FOLDING,
  ironing: Station.FOLDING,
  'ironing and folding': Station.FOLDING,
  ironing_and_folding: Station.FOLDING,
  dispatch: Station.DISPATCH,
  packing: Station.DISPATCH,
  'packing and dispatch': Station.DISPATCH,
  shipping: Station.DISPATCH,
};

/** Returns null rather than guessing when a label is not recognised. */
export function parseStation(raw: unknown): Station | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalised = raw.trim().toLowerCase();
  return STATION_ALIASES[normalised] ?? null;
}
