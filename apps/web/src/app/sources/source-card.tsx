'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RunStatusBadge, SourceStatusBadge } from '@/components/badge';
import { api } from '@/lib/api';
import type { CollectionRun, DiscoveryResult, Source, TestResult } from '@/lib/types';
import { SelectionEditor } from './selection-editor';

const TYPE_LABELS: Record<Source['type'], string> = {
  APPLICATION_API: 'Application API',
  CRAWLER: 'Data crawler',
  DATABASE: 'Database connection',
  MQTT: 'MQTT',
};

export function SourceCard({
  source,
  expanded,
  onToggle,
}: {
  source: Source;
  expanded: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
    void queryClient.invalidateQueries({ queryKey: ['records'] });
    void queryClient.invalidateQueries({ queryKey: ['lines'] });
    void queryClient.invalidateQueries({ queryKey: ['batches'] });
  };

  const testMutation = useMutation({
    mutationFn: () => api.post<TestResult>(`/sources/${source.id}/test`),
    onSuccess: (result) => {
      setTestResult(result);
      invalidate();
    },
  });

  const discoverMutation = useMutation({
    mutationFn: () => api.get<DiscoveryResult>(`/sources/${source.id}/schema`),
    onSuccess: setDiscovery,
  });

  const collectMutation = useMutation({
    mutationFn: () => api.post<CollectionRun>(`/sources/${source.id}/collect`),
    onSuccess: invalidate,
  });

  const runsQuery = useQuery({
    queryKey: ['runs', source.id],
    queryFn: () => api.get<CollectionRun[]>(`/sources/${source.id}/runs`),
    enabled: expanded,
    refetchInterval: expanded ? 4_000 : false,
  });

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{source.name}</span>
          <span className="text-xs text-[var(--color-text-muted)]">{TYPE_LABELS[source.type]}</span>
          <SourceStatusBadge status={source.status} />
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          {source.lastRun && <RunStatusBadge status={source.lastRun.status} />}
          <span>{source.recordCount ?? 0} records collected</span>
          <span className="text-[var(--color-text-muted)]">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-[var(--color-border)] px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-60"
            >
              {testMutation.isPending ? 'Testing…' : 'Test connection'}
            </button>
            <button
              onClick={() => discoverMutation.mutate()}
              disabled={discoverMutation.isPending}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-60"
            >
              {discoverMutation.isPending ? 'Discovering…' : 'Discover schema'}
            </button>
            <button
              onClick={() => collectMutation.mutate()}
              disabled={collectMutation.isPending}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
            >
              {collectMutation.isPending ? 'Collecting…' : 'Run collection'}
            </button>
          </div>

          {testResult && (
            <div className={`rounded-md p-3 text-sm ${testResult.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
              <p className="font-medium">{testResult.ok ? 'Connection verified' : 'Connection failed'}</p>
              <p>{testResult.message}</p>
              {testResult.details && (
                <pre className="mt-1 overflow-x-auto text-xs opacity-80">{JSON.stringify(testResult.details, null, 2)}</pre>
              )}
            </div>
          )}
          {source.lastVerifyError && !testResult && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">Last verification failed: {source.lastVerifyError}</p>
          )}

          {discovery && (
            <SelectionEditor sourceId={source.id} source={source} discovery={discovery} onSaved={invalidate} />
          )}

          {collectMutation.data && (
            <RunSummary run={collectMutation.data} />
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Collection history
            </h3>
            {runsQuery.data && runsQuery.data.length > 0 ? (
              <ul className="space-y-2">
                {runsQuery.data.map((run) => (
                  <li key={run.id}>
                    <RunSummary run={run} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">No runs yet.</p>
            )}
          </div>

          <details className="text-xs text-[var(--color-text-muted)]">
            <summary className="cursor-pointer select-none">Stored configuration</summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-slate-50 p-3">{JSON.stringify(source.config, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

function RunSummary({ run }: { run: CollectionRun }) {
  const duration = run.durationMs !== null ? `${run.durationMs}ms` : '—';
  return (
    <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          <span className="text-xs text-[var(--color-text-muted)]">{new Date(run.startedAt).toLocaleString()}</span>
        </div>
        <span className="text-xs text-[var(--color-text-muted)]">{duration}</span>
      </div>
      <dl className="mt-2 grid grid-cols-5 gap-2 text-xs">
        <Stat label="Read" value={run.counts.read} />
        <Stat label="Stored" value={run.counts.stored} />
        <Stat label="Duplicate" value={run.counts.duplicate} />
        <Stat label="Rejected" value={run.counts.rejected} />
        <Stat label="Errors" value={run.counts.errors} />
      </dl>
      {run.errors.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-red-700">
          {run.errors.map((error, index) => (
            <li key={index}>• {error.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
