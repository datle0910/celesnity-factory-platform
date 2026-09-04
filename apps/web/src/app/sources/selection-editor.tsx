'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { DiscoveryResult, Source } from '@/lib/types';

/**
 * What the operator chooses depends on how the source exposes itself:
 * datasets to tick for the application API and crawler, or a table plus a
 * column mapping for a database, whose shape is only known at discovery time.
 */
export function SelectionEditor({
  sourceId,
  source,
  discovery,
  onSaved,
}: {
  sourceId: string;
  source: Source;
  discovery: DiscoveryResult;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();

  const existingDatasets = Array.isArray(source.config.datasets) ? (source.config.datasets as string[]) : [];
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set(existingDatasets));

  const [table, setTable] = useState<string>((source.config.table as string) ?? '');
  const existingMapping = (source.config.columnMapping as Record<string, string>) ?? {};
  const [mapping, setMapping] = useState<Record<string, string>>({
    sourceRecordId: existingMapping.sourceRecordId ?? '',
    batchId: existingMapping.batchId ?? '',
    station: existingMapping.station ?? '',
    quantity: existingMapping.quantity ?? '',
    occurredAt: existingMapping.occurredAt ?? '',
    recordedAt: existingMapping.recordedAt ?? '',
  });

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/sources/${sourceId}/selection`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      onSaved();
    },
  });

  function toggleDataset(name: string) {
    setSelectedDatasets((current) => {
      const next = new Set(current);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  const selectedTableDataset = discovery.datasets.find((dataset) => dataset.name === table);

  return (
    <div className="rounded-md border border-[var(--color-border)] p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Discovered — select what to collect
      </h3>

      {discovery.notes && discovery.notes.length > 0 && (
        <ul className="mb-3 list-disc space-y-1 pl-4 text-xs text-[var(--color-text-muted)]">
          {discovery.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}

      {discovery.selectionKind === 'DATASETS' && (
        <div className="space-y-2">
          {discovery.datasets.map((dataset) => (
            <label key={dataset.name} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedDatasets.has(dataset.name)}
                onChange={() => toggleDataset(dataset.name)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{dataset.label}</span>
                {dataset.recordCount !== null && (
                  <span className="text-[var(--color-text-muted)]"> — {dataset.recordCount} records</span>
                )}
                <div className="flex flex-wrap gap-1 pt-1">
                  {dataset.fields.map((field) => (
                    <span key={field.name} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {field.name}: {field.type}
                    </span>
                  ))}
                </div>
              </span>
            </label>
          ))}
          <button
            onClick={() => saveMutation.mutate({ datasets: [...selectedDatasets] })}
            disabled={saveMutation.isPending}
            className="mt-2 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
          >
            Save selection
          </button>
        </div>
      )}

      {discovery.selectionKind === 'TABLE_AND_MAPPING' && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Table</span>
            <select
              value={table}
              onChange={(event) => setTable(event.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              <option value="">Select a table…</option>
              {discovery.datasets.map((dataset) => (
                <option key={dataset.name} value={dataset.name}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>

          {selectedTableDataset && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--color-text-muted)]">Map columns from {selectedTableDataset.name}:</p>
              {(['sourceRecordId', 'batchId', 'station', 'quantity', 'occurredAt', 'recordedAt'] as const).map((field) => (
                <label key={field} className="flex items-center gap-2 text-sm">
                  <span className="w-32 shrink-0 text-[var(--color-text-muted)]">{field}</span>
                  <select
                    value={mapping[field]}
                    onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}
                    className="flex-1 rounded-md border border-[var(--color-border)] px-2 py-1.5 text-sm"
                  >
                    <option value="">— none —</option>
                    {selectedTableDataset.fields.map((columnField) => (
                      <option key={columnField.name} value={columnField.name}>
                        {columnField.name} ({columnField.type})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              const schemaAndTable = table.includes('.') ? table.split('.') : ['public', table];
              saveMutation.mutate({
                schema: schemaAndTable[0],
                table: schemaAndTable[1],
                columnMapping: {
                  sourceRecordId: mapping.sourceRecordId || undefined,
                  batchId: mapping.batchId || undefined,
                  station: mapping.station || undefined,
                  quantity: mapping.quantity || undefined,
                  occurredAt: mapping.occurredAt || undefined,
                  recordedAt: mapping.recordedAt || undefined,
                },
              });
            }}
            disabled={saveMutation.isPending || !table}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
          >
            Save table and mapping
          </button>
        </div>
      )}

      {discovery.selectionKind === 'TOPICS' && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Topics observed: {discovery.datasets.map((dataset) => dataset.name).join(', ') || 'none yet'}. The configured
          topic filter is used as-is; edit the stored configuration to change it.
        </p>
      )}
    </div>
  );
}
