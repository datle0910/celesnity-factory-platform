'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Source } from '@/lib/types';
import { RecordsPreview } from './records-preview';
import { RegisterSourceForm } from './register-source-form';
import { SourceCard } from './source-card';

export default function SourcesPage() {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(false);

  const sourcesQuery = useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<Source[]>('/sources'),
    refetchInterval: 4_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Data Sources</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Register a source, verify it, discover what it offers, choose what to collect, then run collection
            manually.
          </p>
        </div>
        <button
          onClick={() => setShowRegisterForm((value) => !value)}
          className="rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {showRegisterForm ? 'Cancel' : 'Register a source'}
        </button>
      </div>

      {showRegisterForm && (
        <RegisterSourceForm onRegistered={() => setShowRegisterForm(false)} />
      )}

      {sourcesQuery.isLoading && <p className="text-sm text-[var(--color-text-muted)]">Loading sources…</p>}
      {sourcesQuery.isError && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          Could not reach the API. Is it running at the configured base URL?
        </p>
      )}

      <div className="grid gap-4">
        {sourcesQuery.data?.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            expanded={selectedSourceId === source.id}
            onToggle={() => setSelectedSourceId((current) => (current === source.id ? null : source.id))}
          />
        ))}
      </div>

      {sourcesQuery.data && sourcesQuery.data.length === 0 && !showRegisterForm && (
        <p className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">
          No sources registered yet. Register the application API, the supplier portal and the production database
          to start collecting.
        </p>
      )}

      <RecordsPreview />
    </div>
  );
}
