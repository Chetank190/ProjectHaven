import { useState, useEffect } from 'react';
import type { NeedsPayload } from '../../types/api';

interface Props {
  payload:   NeedsPayload;
  onConfirm: (p: NeedsPayload) => void;
}

const NEEDS_LABELS: { key: keyof NeedsPayload; label: string; icon: string }[] = [
  { key: 'needs_shelter',  label: 'Needs a bed tonight',              icon: '🏠' },
  { key: 'needs_rehab',    label: 'Needs detox or mental health',     icon: '🩺' },
  { key: 'needs_food',     label: 'Needs food',                       icon: '🍽' },
  { key: 'needs_supplies', label: 'Needs clothing or supplies',       icon: '🧥' },
  { key: 'needs_hygiene',  label: 'Needs shower or hygiene',          icon: '🚿' },
];

const SECTORS = ['any', 'adult', 'youth', 'family'] as const;

export function PayloadConfirm({ payload, onConfirm }: Props) {
  const [draft,     setDraft]     = useState<NeedsPayload>({ ...payload });
  const [countdown, setCountdown] = useState(5);

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
    <div className="rounded-2xl overflow-hidden shadow-lg" style={{ border: '1px solid #EDD5CC' }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between"
        style={{ background: 'linear-gradient(90deg, #FAD9DE 0%, #FDF0F2 100%)', borderBottom: '1px solid #F4B0BB' }}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" style={{ color: '#9B2335' }} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: '#7D1A2A' }}>
            Confirm Needs
          </h2>
        </div>
        {/* Countdown ring */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium" style={{ color: '#A67F72' }}>
            Auto-submits in
          </span>
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ background: countdown <= 2 ? '#C23B52' : '#9B2335' }}>
            {countdown}
          </span>
        </div>
      </div>

      <div className="p-5 bg-white">
        {/* Toggle list */}
        <div className="space-y-2 mb-5">
          {NEEDS_LABELS.map(({ key, label, icon }) => {
            const checked = Boolean(draft[key]);
            return (
              <label
                key={key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  background: checked ? '#FAD9DE' : '#FDF6F3',
                  border: `1px solid ${checked ? '#F4B0BB' : '#EDD5CC'}`,
                }}
                onClick={() => toggle(key)}
              >
                <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    background: checked ? '#9B2335' : 'white',
                    border: `2px solid ${checked ? '#9B2335' : '#DEBCB2'}`,
                  }}>
                  {checked && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                    </svg>
                  )}
                </div>
                <span className="text-base">{icon}</span>
                <span className="text-sm font-medium" style={{ color: checked ? '#5E1220' : '#5C3A40' }}>
                  {label}
                </span>
              </label>
            );
          })}
        </div>

        {/* Sector selector */}
        <div className="mb-5">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#7A5C54' }}>
            Sector
          </label>
          <select
            value={draft.sector}
            onChange={e => { setCountdown(5); setDraft(d => ({ ...d, sector: e.target.value as NeedsPayload['sector'] })); }}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-medium pr-8 transition-all"
            style={{
              background: '#FDF6F3',
              border: '1.5px solid #EDD5CC',
              color: '#3D2228',
            }}
          >
            {SECTORS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => onConfirm(draft)}
          className="w-full font-semibold py-3 rounded-xl text-sm text-white transition-all"
          style={{ background: 'linear-gradient(135deg, #7D1A2A, #C23B52)', boxShadow: '0 4px 12px rgba(155,35,53,0.3)' }}
        >
          Confirm & Route →
        </button>
      </div>
    </div>
  );
}
