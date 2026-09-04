'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/api';
import type { Source, SourceType } from '@/lib/types';

/**
 * Per-type default configuration, matching what the seed registers against the
 * bundled fixtures. Every field stays editable, so pointing the same source
 * type at a different host is a normal action, not a workaround.
 */
const TEMPLATES: Record<SourceType, { config: Record<string, unknown>; secretHint: string }> = {
  APPLICATION_API: {
    config: { baseUrl: 'http://localhost:4001', datasets: ['work-orders', 'batches', 'receiving', 'dispatch'], pageSize: 3 },
    secretHint: 'The fixture requires no credential.',
  },
  CRAWLER: {
    config: { startUrl: 'http://localhost:4002/deliveries?page=1', maxPages: 20 },
    secretHint: 'The fixture requires no credential.',
  },
  DATABASE: {
    config: {
      host: 'localhost',
      port: 5433,
      database: 'production',
      user: 'factory_reader',
      schema: 'factory',
      table: 'production_events',
      columnMapping: {
        sourceRecordId: 'event_id',
        batchId: 'batch_ref',
        station: 'station',
        quantity: 'quantity',
        occurredAt: 'occurred_at',
        recordedAt: 'recorded_at',
      },
    },
    secretHint: 'Reference an environment variable, e.g. PRODUCTION_DB_PASSWORD, or type the password below.',
  },
  MQTT: {
    config: { brokerUrl: 'mqtt://localhost:1883', topicFilter: 'factory/#' },
    secretHint: 'Optional. Leave blank if the broker allows anonymous connections.',
  },
};

const TYPE_LABELS: Record<SourceType, string> = {
  APPLICATION_API: 'Application API',
  CRAWLER: 'Data crawler',
  DATABASE: 'Database connection',
  MQTT: 'MQTT (optional)',
};

export function RegisterSourceForm({ onRegistered }: { onRegistered: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<SourceType>('APPLICATION_API');
  const [name, setName] = useState('');
  const [configText, setConfigText] = useState(JSON.stringify(TEMPLATES.APPLICATION_API.config, null, 2));
  const [secretMode, setSecretMode] = useState<'none' | 'env' | 'masked'>('none');
  const [secretEnvVar, setSecretEnvVar] = useState('');
  const [secret, setSecret] = useState('');
  const [configError, setConfigError] = useState<string | null>(null);

  const registerMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<Source>('/sources', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      onRegistered();
    },
  });

  function applyTemplate(nextType: SourceType) {
    setType(nextType);
    setConfigText(JSON.stringify(TEMPLATES[nextType].config, null, 2));
    setConfigError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setConfigError(null);

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText) as Record<string, unknown>;
    } catch {
      setConfigError('Configuration must be valid JSON.');
      return;
    }

    registerMutation.mutate({
      name: name || `${TYPE_LABELS[type]} source`,
      type,
      config,
      secretEnvVar: secretMode === 'env' ? secretEnvVar : undefined,
      secret: secretMode === 'masked' ? secret : undefined,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Source type</span>
          <select
            value={type}
            onChange={(event) => applyTemplate(event.target.value as SourceType)}
            className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            {(Object.keys(TYPE_LABELS) as SourceType[]).map((option) => (
              <option key={option} value={option}>
                {TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={`${TYPE_LABELS[type]} source`}
            className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Connection settings (JSON)</span>
        <textarea
          value={configText}
          onChange={(event) => setConfigText(event.target.value)}
          rows={10}
          spellCheck={false}
          className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 font-mono text-xs"
        />
        {configError && <span className="mt-1 block text-xs text-red-600">{configError}</span>}
      </label>

      <fieldset className="rounded-md border border-[var(--color-border)] p-3">
        <legend className="px-1 text-xs font-medium text-[var(--color-text-muted)]">Credential</legend>
        <p className="mb-2 text-xs text-[var(--color-text-muted)]">{TEMPLATES[type].secretHint}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {(['none', 'env', 'masked'] as const).map((mode) => (
            <label key={mode} className="flex items-center gap-1.5">
              <input type="radio" name="secretMode" checked={secretMode === mode} onChange={() => setSecretMode(mode)} />
              {mode === 'none' ? 'None' : mode === 'env' ? 'Environment variable' : 'Enter value'}
            </label>
          ))}
        </div>
        {secretMode === 'env' && (
          <input
            value={secretEnvVar}
            onChange={(event) => setSecretEnvVar(event.target.value)}
            placeholder="PRODUCTION_DB_PASSWORD"
            className="mt-2 w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        )}
        {secretMode === 'masked' && (
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="Credential value — encrypted before storage, never displayed again"
            className="mt-2 w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
          />
        )}
      </fieldset>

      {registerMutation.isError && (
        <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">
          {registerMutation.error instanceof ApiError ? registerMutation.error.message : 'Registration failed.'}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={registerMutation.isPending}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {registerMutation.isPending ? 'Registering…' : 'Register source'}
        </button>
      </div>
    </form>
  );
}
