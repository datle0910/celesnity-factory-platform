'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { RunLink } from '@/components/run-link';
import type { RecordsPage } from '@/lib/types';

/**
 * The normalised-record preview required by the assessment: every collected
 * row, its source and collection run, and — once normalisation has run — which
 * canonical event it fed and why.
 */
export function RecordsPreview() {
  const [rejectedOnly, setRejectedOnly] = useState(false);

  const recordsQuery = useQuery({
    queryKey: ['records', rejectedOnly],
    queryFn: () => api.get<RecordsPage>(`/records?limit=25${rejectedOnly ? '&rejectedOnly=true' : ''}`),
    refetchInterval: 5_000,
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Normalised records</h2>
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <input type="checkbox" checked={rejectedOnly} onChange={(event) => setRejectedOnly(event.target.checked)} />
          Show rejected rows only
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Record id</th>
              <th className="px-3 py-2 font-medium">Batch</th>
              <th className="px-3 py-2 font-medium">Station</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Collected</th>
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {recordsQuery.data?.records.map((record) => (
              <tr key={record.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-3 py-2">{record.source.name}</td>
                <td className="px-3 py-2 font-mono">{record.sourceRecordId}</td>
                <td className="px-3 py-2">{record.normalised.batchId ?? '—'}</td>
                <td className="px-3 py-2">{record.normalised.station ?? '—'}</td>
                <td className="px-3 py-2">{record.normalised.quantity ?? '—'}</td>
                <td className="px-3 py-2 text-[var(--color-text-muted)]">
                  {new Date(record.collectedAt).toLocaleTimeString()}
                </td>
                <td className="px-3 py-2">
                  <RunLink runId={record.collectionRunId} />
                </td>
                <td className="px-3 py-2">
                  {record.parseError ? (
                    <span className="text-red-600" title={record.parseError}>
                      rejected
                    </span>
                  ) : record.contribution ? (
                    <span
                      className={
                        record.contribution.role === 'WINNER'
                          ? 'text-emerald-700'
                          : record.contribution.role === 'DUPLICATE'
                            ? 'text-slate-500'
                            : 'text-amber-700'
                      }
                      title={record.contribution.reason}
                    >
                      {record.contribution.role.toLowerCase()}
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">reference data</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {recordsQuery.data && recordsQuery.data.records.length === 0 && (
          <p className="p-4 text-center text-sm text-[var(--color-text-muted)]">
            No records yet. Run a collection above.
          </p>
        )}
      </div>
      {recordsQuery.data && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Showing {recordsQuery.data.records.length} of {recordsQuery.data.total} records.
        </p>
      )}
    </section>
  );
}
