import { Injectable } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import { Client } from 'pg';
import { parseStation } from '../../domain/stations';
import {
  DEFAULTS,
  type CollectedRecord,
  type Collector,
  type CollectorContext,
  type CollectionError,
  type CollectionOutcome,
  type DatabaseColumnMapping,
  type DatabaseSourceConfig,
  type DiscoveredDataset,
  type DiscoveryResult,
  type TestResult,
} from './collector.types';
import { asDate, asInteger, asString } from './parse';

/**
 * Collector for the factory's production database.
 *
 * Unlike the other sources this one has no fixed shape: the operator picks a
 * table at runtime and says which column means what. That makes identifier
 * handling the central concern. Table and column names never reach a query
 * as free text — every identifier is first checked against information_schema
 * and only an identifier the database itself reported is quoted into SQL, so a
 * crafted selection cannot become an injection. Values are always bound as
 * parameters.
 *
 * The credential is resolved per call and passed in by the caller; it is never
 * read from the stored configuration and never logged.
 */

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

/** Column names the mapping step offers to fill in automatically. */
const MAPPING_HINTS: Record<keyof DatabaseColumnMapping, string[]> = {
  sourceRecordId: ['event_id', 'id', 'record_id', 'uuid', 'pk'],
  batchId: ['batch_ref', 'batch_id', 'batch', 'batchid'],
  station: ['station', 'step', 'stage', 'process_step'],
  quantity: ['quantity', 'qty', 'item_count', 'pieces'],
  occurredAt: ['occurred_at', 'event_time', 'happened_at', 'timestamp', 'occurred'],
  recordedAt: ['recorded_at', 'created_at', 'inserted_at', 'logged_at'],
};

@Injectable()
export class DatabaseCollector implements Collector {
  readonly type = SourceType.DATABASE;

  async test(context: CollectorContext): Promise<TestResult> {
    const config = readConfig(context);

    try {
      return await this.withClient(config, context.credential, async (client) => {
        const version = await client.query<{ version: string }>('SELECT version()');
        const tables = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema <> ALL($1)',
          [SYSTEM_SCHEMAS],
        );

        return {
          ok: true,
          message: `connected to ${config.database} as ${config.user}`,
          details: {
            server: version.rows[0]?.version.split(',')[0] ?? 'unknown',
            visibleTables: Number(tables.rows[0]?.count ?? 0),
          },
        };
      });
    } catch (error) {
      return { ok: false, message: redactConnectionError(error) };
    }
  }

  async discover(context: CollectorContext): Promise<DiscoveryResult> {
    const config = readConfig(context);

    return this.withClient(config, context.credential, async (client) => {
      const columns = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT table_schema, table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema <> ALL($1)
          ORDER BY table_schema, table_name, ordinal_position`,
        [SYSTEM_SCHEMAS],
      );

      const byTable = new Map<string, DiscoveredDataset>();
      for (const row of columns.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        const dataset = byTable.get(key) ?? {
          name: key,
          label: key,
          recordCount: null,
          fields: [],
        };
        dataset.fields.push({
          name: row.column_name,
          type: row.is_nullable === 'YES' ? `${row.data_type} (nullable)` : row.data_type,
          sample: null,
        });
        byTable.set(key, dataset);
      }

      const datasets = [...byTable.values()];

      return {
        selectionKind: 'TABLE_AND_MAPPING',
        datasets,
        notes: [
          'Select one table, then map its columns onto batch, station, quantity and timestamps.',
          'Only tables and columns listed here can be collected; anything else is rejected.',
        ],
      };
    });
  }

  async collect(context: CollectorContext): Promise<CollectionOutcome> {
    const config = readConfig(context);
    const { schema, table, columnMapping } = config;

    if (!schema || !table) {
      throw new Error('no table has been selected for this database source');
    }
    if (!columnMapping) {
      throw new Error('no column mapping has been configured for this database source');
    }

    const records: CollectedRecord[] = [];
    const errors: CollectionError[] = [];

    return this.withClient(config, context.credential, async (client) => {
      const availableColumns = await this.readColumns(client, schema, table);
      if (availableColumns.length === 0) {
        throw new Error(`table ${schema}.${table} does not exist or is not readable`);
      }

      // Every mapped column is checked against what the database reports before
      // it is quoted into the query. An unknown name fails the run rather than
      // reaching SQL.
      const mapped = resolveMapping(columnMapping, availableColumns);

      const selectList = mapped.columns.map((column) => quoteIdentifier(column)).join(', ');
      const sql = `SELECT ${selectList} FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
      const result = await client.query<Record<string, unknown>>(sql);

      for (const row of result.rows) {
        records.push(toRecord(row, columnMapping, `${schema}.${table}`, errors));
      }

      return {
        records,
        errors,
        stats: {
          table: `${schema}.${table}`,
          columnsSelected: mapped.columns,
          columnMapping,
          rowsRead: result.rowCount ?? records.length,
        },
      };
    });
  }

  private async readColumns(client: Client, schema: string, table: string): Promise<string[]> {
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [schema, table],
    );
    return result.rows.map((row) => row.column_name);
  }

  /** Opens a connection, runs the operation and always closes it. */
  private async withClient<T>(
    config: DatabaseSourceConfig,
    credential: string | null,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: credential ?? undefined,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? DEFAULTS.connectionTimeoutMs,
      // Keeps a hung query from holding the collection run open indefinitely.
      statement_timeout: 30_000,
    });

    await client.connect();
    try {
      return await operation(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

/**
 * Suggests a column mapping from the table's own column names, so the operator
 * confirms a proposal instead of typing six field names from scratch.
 */
export function suggestMapping(columns: readonly string[]): Partial<DatabaseColumnMapping> {
  const lookup = new Map(columns.map((column) => [column.toLowerCase(), column]));
  const suggestion: Partial<DatabaseColumnMapping> = {};

  for (const [field, hints] of Object.entries(MAPPING_HINTS) as [keyof DatabaseColumnMapping, string[]][]) {
    for (const hint of hints) {
      const match = lookup.get(hint);
      if (match) {
        suggestion[field] = match;
        break;
      }
    }
  }

  return suggestion;
}

function resolveMapping(
  mapping: DatabaseColumnMapping,
  availableColumns: readonly string[],
): { columns: string[] } {
  const available = new Set(availableColumns);
  const requested = Object.entries(mapping).filter(([, column]) => Boolean(column)) as [string, string][];

  const unknown = requested.filter(([, column]) => !available.has(column));
  if (unknown.length > 0) {
    throw new Error(
      `column mapping refers to columns that do not exist: ${unknown.map(([field, column]) => `${field} -> ${column}`).join(', ')}`,
    );
  }

  // De-duplicated because one column may legitimately serve two mapped fields.
  return { columns: [...new Set(requested.map(([, column]) => column))] };
}

/** Safe only in combination with the information_schema allowlist above. */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toRecord(
  row: Record<string, unknown>,
  mapping: DatabaseColumnMapping,
  dataset: string,
  errors: CollectionError[],
): CollectedRecord {
  const sourceRecordId = asString(row[mapping.sourceRecordId]) ?? String(row[mapping.sourceRecordId] ?? '');
  const base = {
    kind: 'OPERATIONAL_EVENT' as const,
    dataset,
    sourceRecordId: sourceRecordId || `${dataset}:unidentified`,
    payload: row,
  };

  const reject = (message: string): CollectedRecord => {
    errors.push({ stage: 'parse', message, context: { dataset, sourceRecordId } });
    return { ...base, parseError: message };
  };

  if (!sourceRecordId) {
    return reject('row has no value in the column mapped as the record identifier');
  }

  const batchId = asString(row[mapping.batchId]);
  if (!batchId) {
    return reject(`row ${sourceRecordId} has no batch reference`);
  }

  const rawStation = row[mapping.station];
  const station = parseStation(rawStation);
  if (!station) {
    return reject(`row ${sourceRecordId} has an unrecognised station "${String(rawStation ?? '')}"`);
  }

  const occurredAt = asDate(row[mapping.occurredAt]);
  if (!occurredAt) {
    return reject(`row ${sourceRecordId} has an unreadable event time`);
  }

  return {
    ...base,
    batchId,
    station,
    quantity: mapping.quantity ? asInteger(row[mapping.quantity]) : null,
    occurredAt,
    recordedAt: mapping.recordedAt ? asDate(row[mapping.recordedAt]) : null,
  };
}

function readConfig(context: CollectorContext): DatabaseSourceConfig {
  const config = context.source.config as unknown as DatabaseSourceConfig;
  if (!config?.host || !config?.database || !config?.user) {
    throw new Error('database source is missing host, database or user');
  }
  return config;
}

/**
 * pg puts the connection string, and therefore the password, into some error
 * messages. Only the driver's error code and a fixed description are surfaced.
 */
function redactConnectionError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    switch (code) {
      case '28P01':
        return 'authentication failed for the supplied credential';
      case '3D000':
        return 'the requested database does not exist';
      case 'ECONNREFUSED':
        return 'connection refused; the database is not reachable at that host and port';
      case 'ETIMEDOUT':
        return 'connection timed out';
      default:
        return `connection failed (${code})`;
    }
  }
  return 'connection failed';
}
