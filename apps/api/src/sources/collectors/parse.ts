import type { DiscoveredField } from './collector.types';

/**
 * Lenient readers shared by the collectors.
 *
 * Every one of them returns null rather than throwing or coercing. Sources are
 * allowed to be untidy; the collector's job is to notice that a value is
 * unusable and say so, not to guess a plausible substitute.
 */

export function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Rejects decimals and non-numeric text; quantities are whole items. */
export function asInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

export function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'unknown';
  if (value instanceof Date) return 'timestamp';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    return !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}/.test(value) ? 'timestamp' : 'string';
  }
  return Array.isArray(value) ? 'array' : 'object';
}

/** Describes the shape of a sample row for the discovery step. */
export function inferFields(sample: unknown): DiscoveredField[] {
  if (!sample || typeof sample !== 'object') {
    return [];
  }

  return Object.entries(sample as Record<string, unknown>).map(([name, value]) => ({
    name,
    type: inferType(value),
    sample: value === null || value === undefined ? null : String(value).slice(0, 64),
  }));
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** Keeps request logs readable and free of host detail. */
export function stripOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
