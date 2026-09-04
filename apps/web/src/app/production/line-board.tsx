'use client';

import { BatchStateBadge, IndicatorChip } from '@/components/badge';
import type { LineView } from '@/lib/types';
import { STATIONS } from '@/lib/types';
import { formatAge } from './format';

export function LineBoard({ line, onSelectBatch }: { line: LineView; onSelectBatch: (batchId: string) => void }) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">{line.lineId}</h2>
          <span className="text-xs text-[var(--color-text-muted)]">
            {line.batchCount} batches · work orders {line.workOrderIds.join(', ') || '—'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {line.blockedCount > 0 && <span className="text-red-600">{line.blockedCount} blocked</span>}
          {line.staleCount > 0 && <span className="text-amber-600">{line.staleCount} stale</span>}
          <span className="text-emerald-700">{line.completedCount} completed</span>
        </div>
      </header>

      <div className="grid grid-cols-6 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)]">
        {STATIONS.map((station) => {
          const summary = line.stations.find((entry) => entry.station === station);
          return (
            <div key={station} className="px-3 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                {station}
              </p>
              <p className="mt-1 text-xl font-semibold">{summary?.wip ?? 0}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">WIP · {summary?.completedQuantity ?? 0} units</p>
              {(summary?.staleCount ?? 0) > 0 && (
                <p className="mt-1 text-[10px] text-amber-600">{summary?.staleCount} stale</p>
              )}
              {(summary?.blockedCount ?? 0) > 0 && (
                <p className="text-[10px] text-red-600">{summary?.blockedCount} blocked</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--color-text-muted)]">
            <tr>
              <th className="px-4 py-2 font-medium">Batch</th>
              <th className="px-4 py-2 font-medium">Work order</th>
              <th className="px-4 py-2 font-medium">State</th>
              <th className="px-4 py-2 font-medium">Station</th>
              <th className="px-4 py-2 font-medium">Quantity</th>
              <th className="px-4 py-2 font-medium">Last event</th>
              <th className="px-4 py-2 font-medium">Indicators</th>
            </tr>
          </thead>
          <tbody>
            {line.batches.map((batch) => (
              <tr
                key={batch.batchId}
                onClick={() => onSelectBatch(batch.batchId)}
                className="cursor-pointer border-t border-[var(--color-border)] hover:bg-black/[0.03]"
              >
                <td className="px-4 py-2.5 font-medium">{batch.batchId}</td>
                <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{batch.workOrderId ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <BatchStateBadge state={batch.state} />
                </td>
                <td className="px-4 py-2.5">{batch.currentStation ?? '—'}</td>
                <td className="px-4 py-2.5">{batch.completedQuantity ?? '—'}</td>
                <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{formatAge(batch.ageMinutes)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {batch.indicators.map((indicator) => (
                      <IndicatorChip
                        key={indicator.code}
                        code={indicator.code}
                        severity={indicator.severity}
                        title={indicator.message}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
