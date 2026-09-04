import type { BatchState, IndicatorSeverity, RunStatus, SourceStatus } from '@/lib/types';

const STATE_STYLES: Record<BatchState, string> = {
  PLANNED: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  BLOCKED: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
};

export function BatchStateBadge({ state }: { state: BatchState }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_STYLES[state]}`}>
      {state.replace('_', ' ')}
    </span>
  );
}

const RUN_STYLES: Record<RunStatus, string> = {
  RUNNING: 'bg-blue-100 text-blue-700',
  SUCCEEDED: 'bg-emerald-100 text-emerald-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-700',
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${RUN_STYLES[status]}`}>
      {status}
    </span>
  );
}

const SOURCE_STYLES: Record<SourceStatus, string> = {
  REGISTERED: 'bg-slate-100 text-slate-700',
  VERIFIED: 'bg-emerald-100 text-emerald-700',
  ERROR: 'bg-red-100 text-red-700',
};

export function SourceStatusBadge({ status }: { status: SourceStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SOURCE_STYLES[status]}`}>
      {status}
    </span>
  );
}

const SEVERITY_STYLES: Record<IndicatorSeverity, string> = {
  INFO: 'bg-slate-100 text-slate-600',
  WARNING: 'bg-amber-100 text-amber-800',
  CRITICAL: 'bg-red-100 text-red-800',
};

export function IndicatorChip({
  code,
  severity,
  title,
}: {
  code: string;
  severity: IndicatorSeverity;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[severity]}`}
    >
      {code.replace('_', ' ')}
    </span>
  );
}
