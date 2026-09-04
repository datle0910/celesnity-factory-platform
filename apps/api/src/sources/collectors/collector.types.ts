import type { Logger } from '@nestjs/common';
import type { Source, SourceType, Station } from '@prisma/client';

/**
 * What a collected row means. Interpreting the source's shape is the adapter's
 * job, so that normalisation downstream can work on every source in the same
 * terms instead of knowing each source's field names.
 */
export type RecordKind = 'OPERATIONAL_EVENT' | 'WORK_ORDER' | 'BATCH_LINK';

/** Master data: a work order and the line it runs on. */
export interface WorkOrderMaster {
  workOrderId: string;
  lineId: string;
  customer?: string | null;
  dueAt?: Date | null;
  status?: string | null;
}

/** Master data: how a batch joins to its work order and line. */
export interface BatchLinkMaster {
  batchId: string;
  workOrderId: string;
  lineId: string;
  plannedQuantity?: number | null;
  linenType?: string | null;
}

/**
 * One row as the source presented it, together with the platform's reading of
 * it. `payload` is kept verbatim for audit; the projected fields are the
 * platform's interpretation and may be absent when a row carries no operational
 * event or could not be understood.
 */
export interface CollectedRecord {
  kind: RecordKind;
  /** Stable identifier issued by the source system. */
  sourceRecordId: string;
  /** Which dataset, table or topic within the source this came from. */
  dataset: string;
  payload: Record<string, unknown>;

  batchId?: string | null;
  station?: Station | null;
  quantity?: number | null;
  occurredAt?: Date | null;
  recordedAt?: Date | null;

  /** Present when kind is WORK_ORDER. */
  workOrder?: WorkOrderMaster;
  /** Present when kind is BATCH_LINK. */
  batchLink?: BatchLinkMaster;

  /** Set when the row was collected but could not be normalised. */
  parseError?: string | null;
}

export type CollectionStage = 'connect' | 'fetch' | 'parse';

export interface CollectionError {
  stage: CollectionStage;
  message: string;
  context?: Record<string, unknown>;
}

export interface CollectionOutcome {
  records: CollectedRecord[];
  /** Row- and page-level failures that did not abort the run. */
  errors: CollectionError[];
  /** Run-level detail: pages fetched, retries, loop detection, and so on. */
  stats: Record<string, unknown>;
}

export interface TestResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface DiscoveredField {
  name: string;
  type: string;
  sample?: string | null;
}

export interface DiscoveredDataset {
  /** Identifier the operator selects: dataset name, table name or topic. */
  name: string;
  label: string;
  recordCount?: number | null;
  fields: DiscoveredField[];
}

/**
 * How the operator has to narrow a source down before it can be collected.
 * The application API and crawler expose fixed datasets, so selecting which
 * ones to collect is enough. A database is genuinely arbitrary, so the operator
 * also has to say which column means what.
 */
export type SelectionKind = 'DATASETS' | 'TABLE_AND_MAPPING' | 'TOPICS';

export interface DiscoveryResult {
  selectionKind: SelectionKind;
  datasets: DiscoveredDataset[];
  notes?: string[];
}

export interface CollectorContext {
  source: Source;
  /** Resolved at call time; never persisted in plaintext and never logged. */
  credential: string | null;
  logger: Logger;
}

export interface Collector {
  readonly type: SourceType;

  /** Verifies the source is reachable and usable, without collecting. */
  test(context: CollectorContext): Promise<TestResult>;

  /** Reports what is available to collect. */
  discover(context: CollectorContext): Promise<DiscoveryResult>;

  /**
   * Reads everything the operator selected.
   *
   * Implementations must not throw for a single unusable row: a malformed row
   * belongs in `errors`, and in `records` with `parseError` set, so that one bad
   * row never costs the run every good one.
   */
  collect(context: CollectorContext): Promise<CollectionOutcome>;
}

// --- Per-source configuration shapes ---------------------------------------
// Stored in Source.config as JSON. None of these ever holds a credential.

export interface AppApiSourceConfig {
  baseUrl: string;
  /** Datasets the operator chose to collect. */
  datasets?: string[];
  pageSize?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface CrawlerSourceConfig {
  startUrl: string;
  /** Hard stop on pages followed, independent of loop detection. */
  maxPages?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface DatabaseColumnMapping {
  sourceRecordId: string;
  batchId: string;
  station: string;
  quantity?: string;
  occurredAt: string;
  recordedAt?: string;
}

export interface DatabaseSourceConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  ssl?: boolean;
  /** Chosen during discovery. */
  schema?: string;
  table?: string;
  columnMapping?: DatabaseColumnMapping;
  connectionTimeoutMs?: number;
}

export interface MqttSourceConfig {
  brokerUrl: string;
  topicFilter: string;
  username?: string;
  /** Upper bound on buffered messages between collection runs. */
  bufferLimit?: number;
}

export const DEFAULTS = {
  pageSize: 3,
  timeoutMs: 5_000,
  maxRetries: 3,
  maxPages: 50,
  connectionTimeoutMs: 5_000,
  bufferLimit: 1_000,
} as const;
