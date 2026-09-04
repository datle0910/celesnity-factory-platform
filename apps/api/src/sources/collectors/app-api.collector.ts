import { Injectable } from '@nestjs/common';
import { SourceType, Station } from '@prisma/client';
import {
  DEFAULTS,
  type AppApiSourceConfig,
  type CollectedRecord,
  type Collector,
  type CollectorContext,
  type CollectionError,
  type CollectionOutcome,
  type DiscoveredField,
  type DiscoveryResult,
  type TestResult,
} from './collector.types';
import { describeError, fetchWithRetry, HttpRequestError, type AttemptLog } from './http';
import { asDate, asInteger, asString, inferFields, joinUrl, stripOrigin } from './parse';

/**
 * Collector for the laundry's internal application.
 *
 * The API is paginated, occasionally returns a transient 5xx, and can be slow,
 * so every request goes through a bounded retry with a hard timeout. It is also
 * the only source that publishes the batch-to-work-order-to-line mapping, which
 * is what lets every other source be joined to a production line by batch id
 * alone.
 */

interface DatasetDefinition {
  name: string;
  label: string;
  path: string;
  idField: string;
}

const DATASETS: readonly DatasetDefinition[] = [
  { name: 'work-orders', label: 'Work orders', path: '/api/work-orders', idField: 'workOrderId' },
  { name: 'batches', label: 'Batches', path: '/api/batches', idField: 'batchId' },
  { name: 'receiving', label: 'Receiving records', path: '/api/receiving', idField: 'receivingId' },
  { name: 'dispatch', label: 'Dispatch records', path: '/api/dispatch', idField: 'dispatchId' },
];

interface PagedResponse {
  data: unknown;
  pagination?: {
    page?: number;
    pageSize?: number;
    totalItems?: number;
    totalPages?: number;
    hasMore?: boolean;
  };
}

@Injectable()
export class AppApiCollector implements Collector {
  readonly type = SourceType.APPLICATION_API;

  async test(context: CollectorContext): Promise<TestResult> {
    const config = readConfig(context);

    try {
      const response = await fetchWithRetry(joinUrl(config.baseUrl, '/health'), {
        timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
        maxRetries: config.maxRetries ?? DEFAULTS.maxRetries,
      });
      const body = (await response.json()) as Record<string, unknown>;

      return {
        ok: true,
        message: `reachable at ${config.baseUrl}`,
        details: { service: body.service ?? 'unknown', datasets: DATASETS.map((dataset) => dataset.name) },
      };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  }

  /**
   * Fields are inferred from a single small page rather than read from a schema
   * endpoint, because a real internal API rarely offers one.
   */
  async discover(context: CollectorContext): Promise<DiscoveryResult> {
    const config = readConfig(context);
    const timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
    const maxRetries = config.maxRetries ?? DEFAULTS.maxRetries;
    const notes: string[] = [];

    const datasets = await Promise.all(
      DATASETS.map(async (dataset) => {
        try {
          const url = `${joinUrl(config.baseUrl, dataset.path)}?page=1&pageSize=1`;
          const response = await fetchWithRetry(url, { timeoutMs, maxRetries });
          const body = (await response.json()) as PagedResponse;
          const rows = Array.isArray(body.data) ? body.data : [];

          return {
            name: dataset.name,
            label: dataset.label,
            recordCount: body.pagination?.totalItems ?? null,
            fields: inferFields(rows[0]),
          };
        } catch (error) {
          notes.push(`${dataset.name}: ${describeError(error)}`);
          return { name: dataset.name, label: dataset.label, recordCount: null, fields: [] };
        }
      }),
    );

    return { selectionKind: 'DATASETS', datasets, notes: notes.length > 0 ? notes : undefined };
  }

  async collect(context: CollectorContext): Promise<CollectionOutcome> {
    const config = readConfig(context);
    const selected = config.datasets?.length
      ? DATASETS.filter((dataset) => config.datasets?.includes(dataset.name))
      : DATASETS;

    const records: CollectedRecord[] = [];
    const errors: CollectionError[] = [];
    const attempts: AttemptLog[] = [];
    const pagesByDataset: Record<string, number> = {};

    for (const dataset of selected) {
      try {
        const rows = await this.readAllPages(config, dataset, attempts, (page, total) => {
          pagesByDataset[dataset.name] = page;
          return total;
        });

        for (const row of rows) {
          records.push(this.toRecord(dataset, row, errors));
        }
      } catch (error) {
        // One unreachable dataset must not cost the run the other three.
        errors.push({
          stage: 'fetch',
          message: describeError(error),
          context: {
            dataset: dataset.name,
            status: error instanceof HttpRequestError ? error.status : undefined,
          },
        });
      }
    }

    const retries = attempts.filter((attempt) => attempt.retried);

    return {
      records,
      errors,
      stats: {
        datasetsCollected: selected.map((dataset) => dataset.name),
        pagesFetched: pagesByDataset,
        requestCount: attempts.length,
        retryCount: retries.length,
        retries: retries.map((attempt) => ({
          url: stripOrigin(attempt.url),
          attempt: attempt.attempt,
          status: attempt.status,
          error: attempt.error,
        })),
      },
    };
  }

  private async readAllPages(
    config: AppApiSourceConfig,
    dataset: DatasetDefinition,
    attempts: AttemptLog[],
    onPage: (page: number, total: number | null) => unknown,
  ): Promise<Record<string, unknown>[]> {
    const pageSize = config.pageSize ?? DEFAULTS.pageSize;
    const timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
    const maxRetries = config.maxRetries ?? DEFAULTS.maxRetries;

    const rows: Record<string, unknown>[] = [];
    let page = 1;
    let totalPages: number | null = null;

    // Bounded independently of the server's own hasMore flag, so a source that
    // always claims there is another page cannot loop forever.
    const pageCeiling = DEFAULTS.maxPages;

    while (page <= pageCeiling) {
      const url = `${joinUrl(config.baseUrl, dataset.path)}?page=${page}&pageSize=${pageSize}`;
      const response = await fetchWithRetry(url, { timeoutMs, maxRetries }, (log) => attempts.push(log));
      const body = (await response.json()) as PagedResponse;

      if (!Array.isArray(body.data)) {
        throw new Error(`${dataset.path} page ${page} did not return an array`);
      }

      for (const row of body.data) {
        if (row && typeof row === 'object') {
          rows.push(row as Record<string, unknown>);
        }
      }

      totalPages = body.pagination?.totalPages ?? totalPages;
      onPage(page, totalPages);

      const hasMore = body.pagination?.hasMore ?? false;
      if (!hasMore || body.data.length === 0) {
        break;
      }
      page += 1;
    }

    return rows;
  }

  /**
   * Maps one row onto the platform's vocabulary. A row that cannot be
   * understood is still returned, carrying its parse error, so the observation
   * survives in the audit trail instead of disappearing.
   */
  private toRecord(
    dataset: DatasetDefinition,
    row: Record<string, unknown>,
    errors: CollectionError[],
  ): CollectedRecord {
    const sourceRecordId = asString(row[dataset.idField]) ?? `${dataset.name}:${JSON.stringify(row).slice(0, 64)}`;
    const base = { dataset: dataset.name, sourceRecordId, payload: row };

    const reject = (message: string): CollectedRecord => {
      errors.push({ stage: 'parse', message, context: { dataset: dataset.name, sourceRecordId } });
      return { ...base, kind: 'OPERATIONAL_EVENT', parseError: message };
    };

    switch (dataset.name) {
      case 'work-orders': {
        const workOrderId = asString(row.workOrderId);
        const lineId = asString(row.lineId);
        if (!workOrderId || !lineId) {
          return reject('work order is missing workOrderId or lineId');
        }
        return {
          ...base,
          kind: 'WORK_ORDER',
          workOrder: {
            workOrderId,
            lineId,
            customer: asString(row.customer),
            dueAt: asDate(row.dueAt),
            status: asString(row.status),
          },
        };
      }

      case 'batches': {
        const batchId = asString(row.batchId);
        const workOrderId = asString(row.workOrderId);
        const lineId = asString(row.lineId);
        if (!batchId || !workOrderId || !lineId) {
          return reject('batch is missing batchId, workOrderId or lineId');
        }
        return {
          ...base,
          kind: 'BATCH_LINK',
          batchId,
          batchLink: {
            batchId,
            workOrderId,
            lineId,
            plannedQuantity: asInteger(row.plannedQuantity),
            linenType: asString(row.linenType),
          },
        };
      }

      case 'receiving': {
        const batchId = asString(row.batchId);
        const occurredAt = asDate(row.receivedAt);
        if (!batchId || !occurredAt) {
          return reject('receiving record is missing batchId or receivedAt');
        }
        return {
          ...base,
          kind: 'OPERATIONAL_EVENT',
          batchId,
          station: Station.RECEIVING,
          quantity: asInteger(row.quantity),
          occurredAt,
        };
      }

      case 'dispatch': {
        const batchId = asString(row.batchId);
        const occurredAt = asDate(row.dispatchedAt);
        if (!batchId || !occurredAt) {
          return reject('dispatch record is missing batchId or dispatchedAt');
        }
        return {
          ...base,
          kind: 'OPERATIONAL_EVENT',
          batchId,
          station: Station.DISPATCH,
          quantity: asInteger(row.quantity),
          occurredAt,
        };
      }

      default:
        return reject(`unknown dataset ${dataset.name}`);
    }
  }
}

function readConfig(context: CollectorContext): AppApiSourceConfig {
  const config = context.source.config as unknown as AppApiSourceConfig;
  if (!config?.baseUrl) {
    throw new Error('application API source is missing baseUrl');
  }
  return config;
}
