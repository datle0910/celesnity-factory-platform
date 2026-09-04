'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BatchStateBadge, IndicatorChip } from '@/components/badge';
import { RunLink } from '@/components/run-link';
import { api } from '@/lib/api';
import type { BatchDetail, ManagementEvent, ManagementEventType } from '@/lib/types';
import { STATIONS } from '@/lib/types';
import { formatAge } from './format';

const ACTION_LABELS: Record<ManagementEventType, string> = {
  ACKNOWLEDGE_EXCEPTION: 'Acknowledge exception',
  BLOCK: 'Block batch',
  RESUME: 'Resume batch',
  NOTE: 'Add note',
};

export function BatchDrawer({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const batchQuery = useQuery({
    queryKey: ['batch', batchId],
    queryFn: () => api.get<BatchDetail>(`/batches/${batchId}`),
    refetchInterval: 5_000,
  });

  const actionMutation = useMutation({
    mutationFn: (body: { type: ManagementEventType; note?: string }) =>
      api.post<ManagementEvent>(`/batches/${batchId}/events`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['batch', batchId] });
      void queryClient.invalidateQueries({ queryKey: ['lines'] });
      setNote('');
    },
  });

  const batch = batchQuery.data;

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-[var(--color-surface)] shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">{batchId}</h2>
            {batch && (
              <p className="text-xs text-[var(--color-text-muted)]">
                {batch.lineId ?? 'no line'} · {batch.workOrderId ?? 'no work order'} · {batch.linenType ?? '—'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-black/5">
            Close
          </button>
        </header>

        {!batch && <p className="p-6 text-sm text-[var(--color-text-muted)]">Loading…</p>}

        {batch && (
          <div className="flex-1 space-y-6 px-6 py-5">
            <section className="flex flex-wrap items-center gap-2">
              <BatchStateBadge state={batch.state} />
              {batch.indicators.map((indicator) => (
                <IndicatorChip key={indicator.code} code={indicator.code} severity={indicator.severity} title={indicator.message} />
              ))}
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Station progress
              </h3>
              <ol className="space-y-1">
                {STATIONS.map((station) => {
                  const progress = batch.stations.find((entry) => entry.station === station);
                  const reached = progress?.reached ?? false;
                  return (
                    <li
                      key={station}
                      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                        reached ? 'bg-emerald-50' : 'bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={reached ? 'text-emerald-700' : 'text-[var(--color-text-muted)]'}>
                          {station}
                        </span>
                        {progress?.isLate && <IndicatorChip code="LATE" severity="INFO" title="Arrived after a later station" />}
                        {progress?.hasConflict && (
                          <IndicatorChip code="CONFLICT" severity="WARNING" title="Sources disagreed" />
                        )}
                      </span>
                      <span className="text-[var(--color-text-muted)]">
                        {reached ? `${progress?.quantity ?? '—'} units · ${new Date(progress!.occurredAt!).toLocaleString()}` : 'not reached'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Provenance
              </h3>
              <div className="space-y-3">
                {batch.timeline.map((entry) => (
                  <div key={entry.station} className="rounded-md border border-[var(--color-border)] p-3">
                    <p className="text-sm font-medium">
                      {entry.station} — accepted from {entry.contributions.find((c) => c.role === 'WINNER')?.record.source.name ?? 'unknown'}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {(entry.resolution as { rule?: string }).rule ?? ''}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {entry.contributions.map((contribution) => (
                        <li key={contribution.record.id} className="space-y-1 border-t border-[var(--color-border)] pt-1.5 first:border-0 first:pt-0">
                          <div className="flex items-center justify-between gap-2">
                            <span>
                              <span
                                className={
                                  contribution.role === 'WINNER'
                                    ? 'text-emerald-700'
                                    : contribution.role === 'DUPLICATE'
                                      ? 'text-slate-500'
                                      : 'text-amber-700'
                                }
                              >
                                {contribution.role.toLowerCase()}
                              </span>{' '}
                              {contribution.record.source.name} · {contribution.record.sourceRecordId}
                              {contribution.record.quantity !== null ? ` · ${contribution.record.quantity} units` : ''}
                            </span>
                            <span className="text-[var(--color-text-muted)]">{contribution.reason}</span>
                          </div>
                          <RunLink runId={contribution.record.collectionRunId} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Management
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => actionMutation.mutate({ type: 'ACKNOWLEDGE_EXCEPTION' })}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-black/5"
                >
                  {ACTION_LABELS.ACKNOWLEDGE_EXCEPTION}
                </button>
                {batch.isBlocked ? (
                  <button
                    onClick={() => actionMutation.mutate({ type: 'RESUME' })}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:opacity-90"
                  >
                    {ACTION_LABELS.RESUME}
                  </button>
                ) : (
                  <button
                    onClick={() => actionMutation.mutate({ type: 'BLOCK' })}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:opacity-90"
                  >
                    {ACTION_LABELS.BLOCK}
                  </button>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Add a note…"
                  className="flex-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
                />
                <button
                  onClick={() => note.trim() && actionMutation.mutate({ type: 'NOTE', note })}
                  disabled={!note.trim() || actionMutation.isPending}
                  className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-60"
                >
                  Add note
                </button>
              </div>

              <ul className="mt-4 space-y-2">
                {batch.managementEvents.map((event) => (
                  <li key={event.id} className="rounded-md bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-medium">{ACTION_LABELS[event.type]}</span>
                    <span className="text-[var(--color-text-muted)]"> by {event.actor} · {formatAge((Date.now() - new Date(event.createdAt).getTime()) / 60_000)}</span>
                    {event.note && <p className="mt-1 text-[var(--color-text)]">{event.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
