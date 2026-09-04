import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, RunStatus, SourceStatus, type Source, type SourceType } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { SecretsService } from '../config/secrets.service';
import { NormalizationService } from '../normalization/normalization.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollectorRegistry } from './collector.registry';
import type { CollectedRecord, DiscoveryResult, TestResult } from './collectors/collector.types';
import type { ListRecordsQueryDto, RegisterSourceDto, UpdateSelectionDto } from './dto';

/**
 * Orchestrates the source lifecycle: register, verify, discover, select,
 * collect, and inspect.
 *
 * Collection deliberately never fails silently and never fails wholesale. A run
 * always produces a record of what happened — how long it took, how many rows
 * were read, which ones could not be understood and why — even when the source
 * was unreachable, because an operator needs to see the failure as readily as
 * the success.
 */
@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly normalization: NormalizationService,
    private readonly registry: CollectorRegistry,
    private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterSourceDto) {
    if (dto.secret && dto.secretEnvVar) {
      throw new BadRequestException(
        'supply a credential either by environment variable reference or through the masked input, not both',
      );
    }

    const source = await this.prisma.source.create({
      data: {
        organizationId: this.config.organizationId,
        name: dto.name,
        type: dto.type,
        config: dto.config as Prisma.InputJsonValue,
        secretEnvVar: dto.secretEnvVar ?? null,
        secretCipher: dto.secret ? this.secrets.encrypt(dto.secret) : null,
      },
    });

    this.logger.log(`registered source "${source.name}" (${source.type})`);
    return toSourceDto(source);
  }

  async list() {
    const sources = await this.prisma.source.findMany({
      where: { organizationId: this.config.organizationId },
      orderBy: { createdAt: 'asc' },
      include: {
        runs: { orderBy: { startedAt: 'desc' }, take: 1 },
        _count: { select: { records: true } },
      },
    });

    return sources.map((source) => ({
      ...toSourceDto(source),
      recordCount: source._count.records,
      lastRun: source.runs[0] ? toRunDto(source.runs[0]) : null,
    }));
  }

  async get(id: string) {
    const source = await this.findSource(id);
    const recordCount = await this.prisma.sourceRecord.count({ where: { sourceId: id } });
    return { ...toSourceDto(source), recordCount };
  }

  async remove(id: string) {
    await this.findSource(id);
    await this.prisma.source.delete({ where: { id } });
    // Canonical state is derived, so it has to be rebuilt once the source's
    // observations are gone.
    await this.normalization.rebuild();
    return { deleted: true };
  }

  async test(id: string): Promise<TestResult> {
    const source = await this.findSource(id);
    const collector = this.registry.get(source.type);

    let result: TestResult;
    try {
      result = await collector.test({
        source,
        credential: this.secrets.resolve(source),
        logger: this.logger,
      });
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : 'verification failed' };
    }

    await this.prisma.source.update({
      where: { id },
      data: {
        status: result.ok ? SourceStatus.VERIFIED : SourceStatus.ERROR,
        lastVerifiedAt: result.ok ? new Date() : undefined,
        lastVerifyError: result.ok ? null : result.message,
      },
    });

    return result;
  }

  async discover(id: string): Promise<DiscoveryResult> {
    const source = await this.findSource(id);
    const collector = this.registry.get(source.type);

    return collector.discover({
      source,
      credential: this.secrets.resolve(source),
      logger: this.logger,
    });
  }

  /** Merges the operator's choices into the stored, non-secret configuration. */
  async updateSelection(id: string, dto: UpdateSelectionDto) {
    const source = await this.findSource(id);
    const config = { ...(source.config as Record<string, unknown>) };

    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        config[key] = value;
      }
    }

    const updated = await this.prisma.source.update({
      where: { id },
      data: { config: config as Prisma.InputJsonValue },
    });

    return toSourceDto(updated);
  }

  /**
   * Runs a collection end to end.
   *
   * Every observation is written, including rows that could not be normalised
   * and rows that repeat something already seen. Deduplication happens when
   * canonical events are derived, never by discarding what a source said.
   */
  async collect(id: string) {
    const source = await this.findSource(id);
    const collector = this.registry.get(source.type);

    const run = await this.prisma.collectionRun.create({
      data: { sourceId: source.id, status: RunStatus.RUNNING },
    });
    const startedAt = Date.now();

    try {
      const outcome = await collector.collect({
        source,
        credential: this.secrets.resolve(source),
        logger: this.logger,
      });

      const knownIds = await this.readKnownRecordIds(
        source.id,
        outcome.records.map((record) => record.sourceRecordId),
      );

      const seenInThisRun = new Set<string>();
      let duplicates = 0;
      for (const record of outcome.records) {
        if (knownIds.has(record.sourceRecordId) || seenInThisRun.has(record.sourceRecordId)) {
          duplicates += 1;
        }
        seenInThisRun.add(record.sourceRecordId);
      }

      if (outcome.records.length > 0) {
        await this.prisma.sourceRecord.createMany({
          data: outcome.records.map((record) => ({
            sourceId: source.id,
            collectionRunId: run.id,
            sourceRecordId: record.sourceRecordId,
            dataset: record.dataset,
            payload: toJson(record.payload),
            batchId: record.batchId ?? null,
            station: record.station ?? null,
            quantity: record.quantity ?? null,
            occurredAt: record.occurredAt ?? null,
            recordedAt: record.recordedAt ?? null,
            parseError: record.parseError ?? null,
          })),
        });
      }

      await this.applyMasterData(outcome.records);

      const rejected = outcome.records.filter((record) => record.parseError).length;
      const touchedBatchIds = [
        ...new Set(
          outcome.records
            .map((record) => record.batchId)
            .filter((batchId): batchId is string => Boolean(batchId)),
        ),
      ];

      const normalisation = await this.normalization.rebuild(touchedBatchIds);

      const status =
        outcome.errors.length === 0
          ? RunStatus.SUCCEEDED
          : outcome.records.length > rejected
            ? RunStatus.PARTIAL
            : RunStatus.FAILED;

      const finished = await this.prisma.collectionRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          recordsRead: outcome.records.length,
          recordsStored: outcome.records.length,
          recordsDuplicate: duplicates,
          recordsRejected: rejected,
          errorCount: outcome.errors.length,
          errors: outcome.errors as unknown as Prisma.InputJsonValue,
          stats: {
            ...outcome.stats,
            batchesTouched: touchedBatchIds.length,
            canonicalEventsRebuilt: normalisation.eventCount,
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `collection of "${source.name}" finished as ${status}: ${outcome.records.length} records, ${duplicates} repeats, ${rejected} rejected, ${outcome.errors.length} errors`,
      );

      return toRunDto(finished);
    } catch (error) {
      // The run itself failed — an unreachable source, a missing selection, a
      // credential that will not resolve. It is still recorded so the operator
      // sees the attempt and the reason.
      const message = error instanceof Error ? error.message : 'collection failed';

      const failed = await this.prisma.collectionRun.update({
        where: { id: run.id },
        data: {
          status: RunStatus.FAILED,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          errorCount: 1,
          errors: [{ stage: 'connect', message }] as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.warn(`collection of "${source.name}" failed: ${message}`);
      return toRunDto(failed);
    }
  }

  async listRuns(sourceId: string, limit = 20) {
    await this.findSource(sourceId);
    const runs = await this.prisma.collectionRun.findMany({
      where: { sourceId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return runs.map(toRunDto);
  }

  async getRun(runId: string) {
    const run = await this.prisma.collectionRun.findUnique({
      where: { id: runId },
      include: { source: { select: { id: true, name: true, type: true } } },
    });
    if (!run) {
      throw new NotFoundException(`collection run ${runId} was not found`);
    }
    return { ...toRunDto(run), source: run.source };
  }

  /**
   * The normalised-record preview.
   *
   * Each row carries where it came from, which run brought it in, and how
   * normalisation treated it, so an operator can follow a number on the
   * production board back to the observation it came from.
   */
  async listRecords(query: ListRecordsQueryDto) {
    const limit = query.limit ?? 50;

    const where: Prisma.SourceRecordWhereInput = {
      sourceId: query.sourceId,
      collectionRunId: query.collectionRunId,
      batchId: query.batchId,
      ...(query.rejectedOnly ? { parseError: { not: null } } : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.sourceRecord.count({ where }),
      this.prisma.sourceRecord.findMany({
        where,
        orderBy: { collectedAt: 'desc' },
        take: limit,
        skip: query.offset ?? 0,
        include: {
          source: { select: { id: true, name: true, type: true } },
          contributions: {
            select: {
              role: true,
              reason: true,
              canonicalEvent: { select: { id: true, batchId: true, station: true } },
            },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset: query.offset ?? 0,
      records: records.map((record) => ({
        id: record.id,
        sourceRecordId: record.sourceRecordId,
        dataset: record.dataset,
        collectedAt: record.collectedAt,
        source: record.source,
        collectionRunId: record.collectionRunId,
        normalised: {
          batchId: record.batchId,
          station: record.station,
          quantity: record.quantity,
          occurredAt: record.occurredAt,
          recordedAt: record.recordedAt,
        },
        parseError: record.parseError,
        // How the deduplication policy treated this observation.
        contribution: record.contributions[0]
          ? {
              role: record.contributions[0].role,
              reason: record.contributions[0].reason,
              canonicalEventId: record.contributions[0].canonicalEvent.id,
            }
          : null,
        payload: record.payload,
      })),
    };
  }

  /** Rebuilds canonical events from every stored observation. */
  async reconcile() {
    return this.normalization.rebuild();
  }

  private async findSource(id: string): Promise<Source> {
    const source = await this.prisma.source.findFirst({
      where: { id, organizationId: this.config.organizationId },
    });
    if (!source) {
      throw new NotFoundException(`source ${id} was not found`);
    }
    return source;
  }

  private async readKnownRecordIds(sourceId: string, candidateIds: string[]): Promise<Set<string>> {
    if (candidateIds.length === 0) {
      return new Set();
    }

    const known = await this.prisma.sourceRecord.findMany({
      where: { sourceId, sourceRecordId: { in: [...new Set(candidateIds)] } },
      select: { sourceRecordId: true },
      distinct: ['sourceRecordId'],
    });

    return new Set(known.map((record) => record.sourceRecordId));
  }

  /**
   * Work orders and the batch-to-line mapping are reference data rather than
   * events, so they are written straight through. Only the application API
   * publishes them, which is what lets every other source be joined to a line
   * by batch id alone.
   */
  private async applyMasterData(records: readonly CollectedRecord[]): Promise<void> {
    for (const record of records) {
      if (record.kind === 'WORK_ORDER' && record.workOrder) {
        const { workOrderId, lineId, customer, dueAt, status } = record.workOrder;
        await this.prisma.workOrder.upsert({
          where: { workOrderId },
          create: { workOrderId, lineId, customer: customer ?? null, dueAt: dueAt ?? null, status: status ?? null },
          update: { lineId, customer: customer ?? null, dueAt: dueAt ?? null, status: status ?? null },
        });
      }

      if (record.kind === 'BATCH_LINK' && record.batchLink) {
        const { batchId, workOrderId, lineId, plannedQuantity, linenType } = record.batchLink;
        await this.prisma.batchLink.upsert({
          where: { batchId },
          create: {
            batchId,
            workOrderId,
            lineId,
            plannedQuantity: plannedQuantity ?? null,
            linenType: linenType ?? null,
          },
          update: {
            workOrderId,
            lineId,
            plannedQuantity: plannedQuantity ?? null,
            linenType: linenType ?? null,
          },
        });
      }
    }
  }
}

/**
 * Builds the API representation from an explicit field list.
 *
 * This is the single point that keeps credentials out of responses: neither
 * `secretCipher` nor anything derived from it is named here, so a stored secret
 * cannot leak by someone later spreading the row into a response.
 */
export function toSourceDto(source: Source) {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    config: source.config,
    // Whether a credential exists, and how it was supplied — never its value.
    credential: {
      configured: Boolean(source.secretEnvVar || source.secretCipher),
      mode: source.secretEnvVar ? ('ENVIRONMENT_VARIABLE' as const) : source.secretCipher ? ('MASKED_INPUT' as const) : null,
      environmentVariable: source.secretEnvVar,
    },
    lastVerifiedAt: source.lastVerifiedAt,
    lastVerifyError: source.lastVerifyError,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function toRunDto(run: {
  id: string;
  sourceId: string;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  recordsRead: number;
  recordsStored: number;
  recordsDuplicate: number;
  recordsRejected: number;
  errorCount: number;
  errors: Prisma.JsonValue;
  stats: Prisma.JsonValue;
}) {
  return {
    id: run.id,
    sourceId: run.sourceId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    counts: {
      read: run.recordsRead,
      stored: run.recordsStored,
      duplicate: run.recordsDuplicate,
      rejected: run.recordsRejected,
      errors: run.errorCount,
    },
    errors: run.errors,
    stats: run.stats,
  };
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  // Dates and undefined do not survive Prisma's JSON column as-is.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export type { SourceType };
