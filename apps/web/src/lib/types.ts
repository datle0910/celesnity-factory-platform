/**
 * Shapes mirrored from the API's DTOs (apps/api/src/**\/dto.ts and service
 * response builders). Kept in one file, by hand, rather than generated: the
 * assessment window does not leave room to wire up a codegen step, and the
 * surface is small enough that a mismatch would show up immediately in the
 * views that consume it.
 */

export type SourceType = 'APPLICATION_API' | 'CRAWLER' | 'DATABASE' | 'MQTT';
export type SourceStatus = 'REGISTERED' | 'VERIFIED' | 'ERROR';
export type RunStatus = 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
export type Station = 'RECEIVING' | 'SORTING' | 'WASHING' | 'DRYING' | 'FOLDING' | 'DISPATCH';
export type BatchState = 'COMPLETED' | 'BLOCKED' | 'IN_PROGRESS' | 'PLANNED';
export type ManagementEventType = 'ACKNOWLEDGE_EXCEPTION' | 'BLOCK' | 'RESUME' | 'NOTE';
export type ContributionRole = 'WINNER' | 'DUPLICATE' | 'SUPERSEDED';
export type SelectionKind = 'DATASETS' | 'TABLE_AND_MAPPING' | 'TOPICS';
export type IndicatorSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  status: SourceStatus;
  config: Record<string, unknown>;
  credential: {
    configured: boolean;
    mode: 'ENVIRONMENT_VARIABLE' | 'MASKED_INPUT' | null;
    environmentVariable: string | null;
  };
  lastVerifiedAt: string | null;
  lastVerifyError: string | null;
  createdAt: string;
  updatedAt: string;
  recordCount?: number;
  lastRun?: CollectionRun | null;
}

export interface CollectionRun {
  id: string;
  sourceId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  counts: {
    read: number;
    stored: number;
    duplicate: number;
    rejected: number;
    errors: number;
  };
  errors: { stage: string; message: string; context?: Record<string, unknown> }[];
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
  name: string;
  label: string;
  recordCount: number | null;
  fields: DiscoveredField[];
}

export interface DiscoveryResult {
  selectionKind: SelectionKind;
  datasets: DiscoveredDataset[];
  notes?: string[];
}

export interface NormalizedRecordPreview {
  id: string;
  sourceRecordId: string;
  dataset: string;
  collectedAt: string;
  source: { id: string; name: string; type: SourceType };
  collectionRunId: string;
  normalised: {
    batchId: string | null;
    station: Station | null;
    quantity: number | null;
    occurredAt: string | null;
    recordedAt: string | null;
  };
  parseError: string | null;
  contribution: { role: ContributionRole; reason: string; canonicalEventId: string } | null;
  payload: Record<string, unknown>;
}

export interface RecordsPage {
  total: number;
  limit: number;
  offset: number;
  records: NormalizedRecordPreview[];
}

export interface Indicator {
  code: string;
  severity: IndicatorSeverity;
  message: string;
  detail?: Record<string, unknown>;
}

export interface StationProgress {
  station: Station;
  reached: boolean;
  quantity: number | null;
  occurredAt: string | null;
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
  completedQuantity: number | null;
  stations: StationProgress[];
  missingStations: Station[];
  lastEventAt: string | null;
  ageMinutes: number | null;
  isStale: boolean;
  isBlocked: boolean;
  blockedSince: string | null;
  acknowledgedAt: string | null;
  indicators: Indicator[];
}

export interface ManagementEvent {
  id: string;
  batchId: string;
  organizationId: string;
  type: ManagementEventType;
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface Contribution {
  role: ContributionRole;
  reason: string;
  record: {
    id: string;
    sourceRecordId: string;
    dataset: string;
    collectedAt: string;
    quantity: number | null;
    occurredAt: string | null;
    collectionRunId: string;
    payload: Record<string, unknown>;
    source: { id: string; name: string; type: SourceType };
  };
}

export interface TimelineEntry {
  station: Station;
  quantity: number | null;
  occurredAt: string;
  observedAt: string;
  acceptedAt: string;
  isLate: boolean;
  hasConflict: boolean;
  resolution: Record<string, unknown>;
  contributions: Contribution[];
}

export interface BatchDetail extends BatchView {
  linenType: string | null;
  timeline: TimelineEntry[];
  managementEvents: ManagementEvent[];
}

export interface StationSummary {
  station: Station;
  wip: number;
  batchIds: string[];
  completedQuantity: number;
  lastEventAt: string | null;
  staleCount: number;
  blockedCount: number;
  missingDataCount: number;
}

export interface LineView {
  lineId: string;
  workOrderIds: string[];
  batchCount: number;
  stations: StationSummary[];
  lastEventAt: string | null;
  staleCount: number;
  blockedCount: number;
  completedCount: number;
  batches: BatchView[];
}

export interface LinesResponse {
  staleThresholdMinutes: number;
  generatedAt: string;
  lines: LineView[];
}

export const STATIONS: readonly Station[] = ['RECEIVING', 'SORTING', 'WASHING', 'DRYING', 'FOLDING', 'DISPATCH'];
