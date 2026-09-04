import { Injectable } from '@nestjs/common';

/**
 * Configuration is read and validated exactly once, at boot. A misconfigured
 * deployment fails immediately with a specific message rather than surfacing as
 * a confusing runtime error during a collection run.
 */
@Injectable()
export class AppConfig {
  readonly port: number;
  readonly staleThresholdMinutes: number;
  readonly quantityTolerance: number;

  readonly organizationId: string;
  readonly organizationName: string;
  readonly defaultActor: string;

  /** 32-byte key backing the masked secret input. */
  readonly secretEncryptionKey: Buffer;

  constructor() {
    this.port = readInteger('API_PORT', 4000, { min: 1, max: 65_535 });
    this.staleThresholdMinutes = readNumber('STALE_THRESHOLD_MINUTES', 15, { min: 0 });
    this.quantityTolerance = readNumber('QUANTITY_TOLERANCE', 0.05, { min: 0, max: 1 });

    this.organizationId = process.env.SEED_ORGANIZATION_ID ?? 'org-celesnity-laundry';
    this.organizationName = process.env.SEED_ORGANIZATION_NAME ?? 'Celesnity Industrial Laundry';
    this.defaultActor = process.env.SEED_ACTOR ?? 'line.manager@celesnity.local';

    this.secretEncryptionKey = readEncryptionKey();
  }
}

function readNumber(name: string, fallback: number, bounds: { min?: number; max?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, received "${raw}"`);
  }
  if (bounds.min !== undefined && value < bounds.min) {
    throw new Error(`${name} must be at least ${bounds.min}, received ${value}`);
  }
  if (bounds.max !== undefined && value > bounds.max) {
    throw new Error(`${name} must be at most ${bounds.max}, received ${value}`);
  }
  return value;
}

function readInteger(name: string, fallback: number, bounds: { min?: number; max?: number } = {}): number {
  const value = readNumber(name, fallback, bounds);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, received ${value}`);
  }
  return value;
}

function readEncryptionKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('SECRET_ENCRYPTION_KEY must be 64 hexadecimal characters, i.e. 32 bytes');
  }
  return Buffer.from(raw, 'hex');
}
