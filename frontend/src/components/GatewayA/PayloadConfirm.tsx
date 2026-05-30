import { useState, useEffect } from 'react';
import type { NeedsPayload } from '../../types/api';

interface Props {
  payload:   NeedsPayload;
  onConfirm: (p: NeedsPayload) => void;
}

const NEEDS_LABELS: [keyof NeedsPayload, string][] = [
  ['needs_shelter',  'Needs a bed tonight'],
  ['needs_rehab',    'Needs detox or mental health support'],
  ['needs_food',     'Needs food'],
  ['needs_supplies', 'Needs clothing or supplies'],
  ['needs_hygiene',  'Needs shower or hygiene'],
];

const SECTORS = ['any', 'adult', 'youth', 'family'] as const;

export function PayloadConfirm({ payload, onConfirm }: Props) {
  const [draft, setDraft] = useState<NeedsPayload>({ ...payload });
  const [countdown, setCountdown] = useState(5);

  // Auto-submit after 5s of no interaction
  useEffect(() => {
    if (countdown <= 0) { onConfirm(draft); return; }
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const toggle = (key: keyof NeedsPayload) => {
    setCountdown(5);
    setDraft(d => ({ ...d, [key]: !d[key as keyof NeedsPayload] }));
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Confirm Needs</h2>
        <span className="text-sm text-gray-400">Auto-submits in {countdown}s</span>
      </div>

      <div className="space-y-3 mb-5">
        {NEEDS_LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(draft[key])}
              onChange={() => toggle(key)}
              className="w-5 h-5 rounded accent-blue-600"
            />
            <span className="text-gray-700">{label}</span>
          </label>
        ))}
      </div>

      <div className="mb-5">
        <label className="block text-sm font-medium text-gray-600 mb-1">Sector</label>
        <select
          value={draft.sector}
          onChange={e => { setCountdown(5); setDraft(d => ({ ...d, sector: e.target.value as NeedsPayload['sector'] })); }}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-700"
        >
          {SECTORS.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      <button
        onClick={() => onConfirm(draft)}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition"
      >
        Submit &rarr;
      </button>
    </div>
  );
}
