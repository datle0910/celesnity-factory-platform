import { Injectable } from '@nestjs/common';
import { SourceType, Station } from '@prisma/client';
import * as cheerio from 'cheerio';
import {
  DEFAULTS,
  type CollectedRecord,
  type Collector,
  type CollectorContext,
  type CollectionError,
  type CollectionOutcome,
  type CrawlerSourceConfig,
  type DiscoveredField,
  type DiscoveryResult,
  type TestResult,
} from './collector.types';
import { describeError, fetchWithRetry, type AttemptLog } from './http';
import { asInteger, asString, stripOrigin } from './parse';

/**
 * Collector for the supplier's delivery portal.
 *
 * Two properties of real portals shape this implementation:
 *
 *   Pagination cannot be trusted to terminate. This portal's last page links
 *   back to its first, so following "next" naively never ends. Every visited
 *   URL is remembered and a hard page ceiling applies on top of that, so the
 *   crawl always terminates and says why it stopped.
 *
 *   Rows are frequently unusable — a placeholder where a number should be, a
 *   missing reference. A single such row must not cost the run every other row
 *   on the page, so rows are validated individually and failures are reported
 *   alongside the data rather than thrown.
 */

/** Column selectors, kept together so the portal's markup is described once. */
const SELECTORS = {
  table: 'table#deliveries',
  row: 'tbody tr',
  recordIdAttribute: 'data-record-id',
  deliveryNumber: 'td.delivery-number',
  supplier: 'td.supplier',
  batch: 'td.batch',
  quantity: 'td.quantity',
  deliveredAt: 'td.delivered-at time',
  nextLink: 'a.pagination-next',
} as const;

type StopReason = 'NO_NEXT_LINK' | 'PAGINATION_LOOP_DETECTED' | 'PAGE_LIMIT_REACHED';

@Injectable()
export class CrawlerCollector implements Collector {
  readonly type = SourceType.CRAWLER;

  async test(context: CollectorContext): Promise<TestResult> {
    const config = readConfig(context);

    try {
      const response = await fetchWithRetry(config.startUrl, {
        timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
        maxRetries: config.maxRetries ?? DEFAULTS.maxRetries,
      });
      const $ = cheerio.load(await response.text());
      const rowCount = $(SELECTORS.table).find(SELECTORS.row).length;

      if ($(SELECTORS.table).length === 0) {
        return {
          ok: false,
          message: `${config.startUrl} responded, but no delivery table was found`,
        };
      }

      return {
        ok: true,
        message: `delivery table found with ${rowCount} rows on the first page`,
        details: { rowsOnFirstPage: rowCount },
      };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  }

  async discover(context: CollectorContext): Promise<DiscoveryResult> {
    const config = readConfig(context);

    const response = await fetchWithRetry(config.startUrl, {
      timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
      maxRetries: config.maxRetries ?? DEFAULTS.maxRetries,
    });
    const $ = cheerio.load(await response.text());

    const headers = $(SELECTORS.table)
      .find('thead th')
      .map((_index, element) => $(element).text().trim())
      .get();

    const firstRow = $(SELECTORS.table).find(SELECTORS.row).first();
    const cells = firstRow
      .find('td')
      .map((_index, element) => $(element).text().trim())
      .get();

    const fields: DiscoveredField[] = headers.map((header, index) => ({
      name: header,
      type: index === 3 ? 'number' : index === 4 ? 'timestamp' : 'string',
      sample: cells[index] ?? null,
    }));

    // The stable identifier is an attribute rather than a column, so it would
    // be invisible to an operator reading the rendered page.
    fields.unshift({
      name: SELECTORS.recordIdAttribute,
      type: 'string',
      sample: firstRow.attr(SELECTORS.recordIdAttribute) ?? null,
    });

    return {
      selectionKind: 'DATASETS',
      datasets: [
        {
          name: 'deliveries',
          label: 'Delivery notes',
          recordCount: null,
          fields,
        },
      ],
      notes: [
        'Row identity comes from the data-record-id attribute, not from any visible column.',
        'Every delivery is normalised to the RECEIVING station.',
      ],
    };
  }

  async collect(context: CollectorContext): Promise<CollectionOutcome> {
    const config = readConfig(context);
    const maxPages = config.maxPages ?? DEFAULTS.maxPages;
    const timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
    const maxRetries = config.maxRetries ?? DEFAULTS.maxRetries;

    const records: CollectedRecord[] = [];
    const errors: CollectionError[] = [];
    const attempts: AttemptLog[] = [];

    const visited = new Set<string>();
    const visitedOrder: string[] = [];

    let currentUrl: string | null = config.startUrl;
    let stopReason: StopReason = 'NO_NEXT_LINK';
    let pageNumber = 0;

    while (currentUrl) {
      if (visited.has(currentUrl)) {
        stopReason = 'PAGINATION_LOOP_DETECTED';
        errors.push({
          stage: 'fetch',
          message: `pagination returned to ${stripOrigin(currentUrl)}, which had already been crawled; stopping to avoid a loop`,
          context: { url: stripOrigin(currentUrl), pagesCrawled: visited.size },
        });
        break;
      }

      if (visited.size >= maxPages) {
        stopReason = 'PAGE_LIMIT_REACHED';
        errors.push({
          stage: 'fetch',
          message: `stopped after the configured maximum of ${maxPages} pages`,
          context: { maxPages },
        });
        break;
      }

      visited.add(currentUrl);
      visitedOrder.push(stripOrigin(currentUrl));
      pageNumber += 1;

      let html: string;
      try {
        const response = await fetchWithRetry(currentUrl, { timeoutMs, maxRetries }, (log) => attempts.push(log));
        html = await response.text();
      } catch (error) {
        // A page that will not load ends the crawl, but everything collected
        // from earlier pages is kept.
        errors.push({
          stage: 'fetch',
          message: describeError(error),
          context: { url: stripOrigin(currentUrl), page: pageNumber },
        });
        break;
      }

      const $ = cheerio.load(html);
      const rows = $(SELECTORS.table).find(SELECTORS.row);

      if (rows.length === 0 && pageNumber === 1) {
        errors.push({
          stage: 'parse',
          message: 'no delivery rows found on the first page; the portal layout may have changed',
          context: { url: stripOrigin(currentUrl) },
        });
      }

      rows.each((index, element) => {
        const row = $(element);
        const raw: RawDeliveryRow = {
          recordId: asString(row.attr(SELECTORS.recordIdAttribute)),
          deliveryNumber: asString(row.find(SELECTORS.deliveryNumber).text()),
          supplier: asString(row.find(SELECTORS.supplier).text()),
          batchId: asString(row.find(SELECTORS.batch).text()),
          quantity: asString(row.find(SELECTORS.quantity).text()),
          deliveredAt: asString(row.find(SELECTORS.deliveredAt).attr('datetime')),
          page: pageNumber,
          rowIndex: index,
        };

        const { record, error } = normaliseDeliveryRow(raw);
        if (error) {
          errors.push(error);
        }
        records.push(record);
      });

      const nextHref = $(SELECTORS.nextLink).attr('href');
      currentUrl = nextHref ? new URL(nextHref, currentUrl).toString() : null;
    }

    const retries = attempts.filter((attempt) => attempt.retried);

    return {
      records,
      errors,
      stats: {
        pagesCrawled: visited.size,
        pagesVisited: visitedOrder,
        stopReason,
        maxPages,
        requestCount: attempts.length,
        retryCount: retries.length,
      },
    };
  }

}

/** A delivery row read off the page, before any validation. */
export interface RawDeliveryRow {
  recordId: string | null;
  deliveryNumber: string | null;
  supplier: string | null;
  batchId: string | null;
  quantity: string | null;
  deliveredAt: string | null;
  page: number;
  rowIndex: number;
}

/**
 * Validates one delivery row.
 *
 * Kept free of cheerio so the rules that decide whether a row is usable can be
 * exercised directly. A rejected row still produces a record: the observation
 * happened and belongs in the audit trail, it simply carries the reason it
 * could not be turned into an event.
 */
export function normaliseDeliveryRow(raw: RawDeliveryRow): {
  record: CollectedRecord;
  error?: CollectionError;
} {
  const payload = {
    recordId: raw.recordId,
    deliveryNumber: raw.deliveryNumber,
    supplier: raw.supplier,
    batchId: raw.batchId,
    quantity: raw.quantity,
    deliveredAt: raw.deliveredAt,
    page: raw.page,
  };

  // Without a stable identifier the row cannot be recognised again on a later
  // run, so it falls back to a positional key and is flagged.
  const sourceRecordId = raw.recordId ?? raw.deliveryNumber ?? `page-${raw.page}-row-${raw.rowIndex}`;
  const base = { kind: 'OPERATIONAL_EVENT' as const, dataset: 'deliveries', sourceRecordId, payload };

  const reject = (message: string) => ({
    record: { ...base, parseError: message },
    error: {
      stage: 'parse' as const,
      message,
      context: {
        sourceRecordId,
        deliveryNumber: raw.deliveryNumber,
        page: raw.page,
        row: raw.rowIndex,
      },
    },
  });

  const label = raw.deliveryNumber ?? sourceRecordId;

  if (!raw.recordId) {
    return reject('row has no data-record-id attribute, so it cannot be identified across runs');
  }
  if (!raw.batchId) {
    return reject(`delivery ${label} has no batch reference`);
  }

  const quantity = asInteger(raw.quantity);
  if (quantity === null) {
    return reject(`delivery ${label} has a non-numeric quantity "${raw.quantity ?? ''}"`);
  }

  const occurredAt = raw.deliveredAt ? new Date(raw.deliveredAt) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
    return reject(`delivery ${label} has an unreadable delivery time`);
  }

  return {
    record: {
      ...base,
      batchId: raw.batchId,
      station: Station.RECEIVING,
      quantity,
      occurredAt,
    },
  };
}

function readConfig(context: CollectorContext): CrawlerSourceConfig {
  const config = context.source.config as unknown as CrawlerSourceConfig;
  if (!config?.startUrl) {
    throw new Error('crawler source is missing startUrl');
  }
  return config;
}
