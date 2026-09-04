import { ManagementEventType, SourceType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Request shapes.
 *
 * A credential may be supplied two ways and never in a third: `secretEnvVar`
 * names an environment variable the platform reads at connect time, or `secret`
 * carries a value typed into the masked field, which is encrypted before it is
 * stored. Neither is ever echoed back — responses are assembled from an
 * explicit field list rather than by spreading the database row.
 */
export class RegisterSourceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEnum(SourceType)
  type!: SourceType;

  @IsObject()
  config!: Record<string, unknown>;

  /** Name of the environment variable holding the credential. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  secretEnvVar?: string;

  /** Value from the masked input. Encrypted at rest, never returned. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  secret?: string;
}

export class ColumnMappingDto {
  @IsString() @IsNotEmpty() sourceRecordId!: string;
  @IsString() @IsNotEmpty() batchId!: string;
  @IsString() @IsNotEmpty() station!: string;
  @IsOptional() @IsString() quantity?: string;
  @IsString() @IsNotEmpty() occurredAt!: string;
  @IsOptional() @IsString() recordedAt?: string;
}

/**
 * What the operator chose to collect. Every field is optional because the
 * relevant ones differ by source type: datasets for the application API and
 * crawler, a table and mapping for a database, a topic filter for MQTT.
 */
export class UpdateSelectionDto {
  @IsOptional()
  @IsString({ each: true })
  datasets?: string[];

  @IsOptional()
  @IsString()
  schema?: string;

  @IsOptional()
  @IsString()
  table?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ColumnMappingDto)
  columnMapping?: ColumnMappingDto;

  @IsOptional()
  @IsString()
  topicFilter?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(60_000)
  timeoutMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxPages?: number;
}

export class ListRecordsQueryDto {
  @IsOptional() @IsString() sourceId?: string;
  @IsOptional() @IsString() collectionRunId?: string;
  @IsOptional() @IsString() batchId?: string;

  /** Restricts the preview to rows that failed to normalise. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  rejectedOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class CreateManagementEventDto {
  @IsEnum(ManagementEventType)
  type!: ManagementEventType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** Falls back to the seeded actor when the caller does not identify one. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actor?: string;
}

export class ProductionQueryDto {
  @IsOptional() @IsString() lineId?: string;

  /** Overrides the configured stale threshold for this request only. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_080)
  staleThresholdMinutes?: number;
}

/** Convenience shape used by the seed and by the registration form. */
export class TestConnectionDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;
}
