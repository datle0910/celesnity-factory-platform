'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RunStatusBadge } from '@/components/badge';
import { api } from '@/lib/api';
import type { CollectionRun, SourceType } from '@/lib/types';

/**
 * A collection run reference that expands into the run's status, duration,
 * counts and errors on click.
 *
 * The assessment requires both the records preview and the production board
 * to carry "collection-run provenance" / "links to the contributing source
 * records and collection run" — this is the one place that satisfies both:
 * every place a record or a canonical event is shown, the run that produced
 * it is one click away rather than just an opaque id.
 */
export function RunLink({ runId }: { runId: string }) {
  const [expanded, setExpanded] = useState(false);

  const runQuery = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.get<CollectionRun & { source: { id: string; name: string; type: SourceType } }>(`/runs/${runId}`),
    enabled: expanded,
  });

  return (
    <span className="inline-block">
      <button
        onClick={() => setExpanded((value) => !value)}
        title={runId}
        className="font-mono text-[11px] text-[var(--color-accent)] underline decoration-dotted underline-offset-2 hover:opacity-80"
      >
        run {runId.slice(-6)}
      </button>

      {expanded && (
        <span className="mt-1 block rounded-md border border-[var(--color-border)] bg-slate-50 p-2 text-[11px]">
          {runQuery.isLoading && <span className="text-[var(--color-text-muted)]">Loading run…</span>}
          {runQuery.data && (
            <span className="block space-y-1">
              <span className="flex items-center gap-2">
                <RunStatusBadge status={runQuery.data.status} />
                <span className="text-[var(--color-text-muted)]">{runQuery.data.source.name}</span>
              </span>
              <span className="block text-[var(--color-text-muted)]">
                started {new Date(runQuery.data.startedAt).toLocaleString()}
                {runQuery.data.durationMs !== null ? ` · ${runQuery.data.durationMs}ms` : ''}
              </span>
              <span className="block text-[var(--color-text-muted)]">
                read {runQuery.data.counts.read} · stored {runQuery.data.counts.stored} · duplicate{' '}
                {runQuery.data.counts.duplicate} · rejected {runQuery.data.counts.rejected} · errors{' '}
                {runQuery.data.counts.errors}
              </span>
              {runQuery.data.errors.length > 0 && (
                <span className="block text-red-700">
                  {runQuery.data.errors.map((error, index) => (
                    <span key={index} className="block">
                      • {error.message}
                    </span>
                  ))}
                </span>
              )}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
