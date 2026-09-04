'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { LinesResponse } from '@/lib/types';
import { BatchDrawer } from './batch-drawer';
import { LineBoard } from './line-board';

export default function ProductionPage() {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [staleThresholdMinutes, setStaleThresholdMinutes] = useState<number | null>(null);

  const linesQuery = useQuery({
    queryKey: ['lines', staleThresholdMinutes],
    queryFn: () =>
      api.get<LinesResponse>(
        `/lines${staleThresholdMinutes !== null ? `?staleThresholdMinutes=${staleThresholdMinutes}` : ''}`,
      ),
    refetchInterval: 5_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Production Lines</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Status by line and station, built from normalised, deduplicated records.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--color-text-muted)]">Stale threshold</span>
          <input
            type="number"
            min={0}
            defaultValue={linesQuery.data?.staleThresholdMinutes}
            placeholder={linesQuery.data ? String(linesQuery.data.staleThresholdMinutes) : '15'}
            onBlur={(event) => {
              const value = Number(event.target.value);
              setStaleThresholdMinutes(Number.isFinite(value) && value >= 0 ? value : null);
            }}
            className="w-20 rounded-md border border-[var(--color-border)] px-2 py-1 text-sm"
          />
          <span className="text-[var(--color-text-muted)]">min</span>
        </label>
      </div>

      {linesQuery.isLoading && <p className="text-sm text-[var(--color-text-muted)]">Loading production status…</p>}
      {linesQuery.isError && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Could not reach the API. Is it running at the configured base URL?
        </p>
      )}

      <div className="space-y-6">
        {linesQuery.data?.lines.map((line) => (
          <LineBoard key={line.lineId} line={line} onSelectBatch={setSelectedBatchId} />
        ))}
      </div>

      {linesQuery.data && linesQuery.data.lines.length === 0 && (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">
          No production data yet. Register the required sources and run a collection from the Data Sources view.
        </p>
      )}

      {selectedBatchId && <BatchDrawer batchId={selectedBatchId} onClose={() => setSelectedBatchId(null)} />}
    </div>
  );
}
