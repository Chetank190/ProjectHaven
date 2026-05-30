import { useState, useEffect, useRef } from 'react';
import type { NeedsPayload } from '../../types/api';

interface Props {
  payload:   NeedsPayload;
  onConfirm: (p: NeedsPayload) => void;
}

const NEEDS_LABELS: { key: keyof NeedsPayload; label: string; icon: string; group?: string }[] = [
  // Acute crisis pillars
  { key: 'needs_shelter',       label: 'Needs a bed tonight',               icon: '🏠', group: 'crisis' },
  { key: 'needs_rehab',         label: 'Needs detox / mental health',       icon: '🩺', group: 'crisis' },
  { key: 'needs_food',          label: 'Needs food',                        icon: '🍽', group: 'crisis' },
  { key: 'needs_supplies',      label: 'Needs clothing or supplies',        icon: '🧥', group: 'crisis' },
  { key: 'needs_hygiene',       label: 'Needs shower or hygiene',           icon: '🚿', group: 'crisis' },
  // Upstream prevention pillars
  { key: 'needs_respite',       label: 'Needs a warming / respite space',   icon: '🌡', group: 'upstream' },
  { key: 'needs_youth_service', label: 'Youth programs (ages 13–24)',       icon: '🏫', group: 'upstream' },
  { key: 'needs_library',       label: 'Internet / library access',         icon: '📚', group: 'upstream' },
];

const SECTORS = ['any', 'adult', 'youth', 'family'] as const;

export function PayloadConfirm({ payload, onConfirm }: Props) {
  const [draft,     setDraft]     = useState<NeedsPayload>({ ...payload });
  const [countdown, setCountdown] = useState(5);
  const submitted                 = useRef(false);

  useEffect(() => {
    if (countdown <= 0) {
      if (!submitted.current) { submitted.current = true; onConfirm(draft); }
      return;
    }
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const toggle = (key: keyof NeedsPayload) => {
    setCountdown(5);
    setDraft(d => ({ ...d, [key]: !d[key as keyof NeedsPayload] }));
  };

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm" style={{ background: 'white', border: '1px solid #D0D8DE' }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between"
        style={{ background: 'linear-gradient(90deg, #D5EFF5, #EFF9FB)', borderBottom: '1px solid #AADEED' }}>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" style={{ color: '#1A7A9A' }} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
          </svg>
          <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#155F79' }}>
            Confirm Needs
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color: '#677D8E' }}>Auto-submits in</span>
          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{ background: countdown <= 2 ? '#1A7A9A' : '#0F4259' }}>
            {countdown}
          </span>
        </div>
      </div>

      <div className="p-5">
        {/* Group label: Acute Crisis */}
        <div className="text-xs font-bold uppercase tracking-widest mb-2 mt-0"
          style={{ color: '#1A7A9A' }}>Acute Crisis</div>
        <div className="space-y-2 mb-4">
          {NEEDS_LABELS.filter(n => n.group === 'crisis').map(({ key, label, icon }) => {
            const checked = Boolean(draft[key]);
            return (
              <label
                key={key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  background: checked ? '#D5EFF5' : '#F5F7F8',
                  border: `1px solid ${checked ? '#AADEED' : '#E9EDF0'}`,
                }}
                onClick={() => toggle(key)}
              >
                <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    background: checked ? '#1A7A9A' : 'white',
                    border: `2px solid ${checked ? '#1A7A9A' : '#B0BDC7'}`,
                  }}>
                  {checked && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                    </svg>
                  )}
                </div>
                <span className="text-base">{icon}</span>
                <span className="text-sm font-medium" style={{ color: checked ? '#0A2A3D' : '#3D4D59' }}>
                  {label}
                </span>
              </label>
            );
          })}
        </div>

        {/* Group label: Upstream Prevention */}
        <div className="text-xs font-bold uppercase tracking-widest mb-2"
          style={{ color: '#3A8A71' }}>Upstream Prevention</div>
        <div className="space-y-2 mb-5">
          {NEEDS_LABELS.filter(n => n.group === 'upstream').map(({ key, label, icon }) => {
            const checked = Boolean(draft[key]);
            return (
              <label
                key={key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  background: checked ? '#F0F7F4' : '#F5F7F8',
                  border: `1px solid ${checked ? '#B4DBCD' : '#E9EDF0'}`,
                }}
                onClick={() => toggle(key)}
              >
                <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                  style={{
                    background: checked ? '#3A8A71' : 'white',
                    border: `2px solid ${checked ? '#3A8A71' : '#B0BDC7'}`,
                  }}>
                  {checked && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/>
                    </svg>
                  )}
                </div>
                <span className="text-base">{icon}</span>
                <span className="text-sm font-medium" style={{ color: checked ? '#0A2A3D' : '#3D4D59' }}>
                  {label}
                </span>
              </label>
            );
          })}
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#506170' }}>
            Sector
          </label>
          <select
            value={draft.sector}
            onChange={e => { setCountdown(5); setDraft(d => ({ ...d, sector: e.target.value as NeedsPayload['sector'] })); }}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-medium pr-8"
            style={{ background: '#F5F7F8', border: '1.5px solid #D0D8DE', color: '#1A2330' }}
          >
            {SECTORS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => onConfirm(draft)}
          className="w-full font-semibold py-3 rounded-xl text-sm text-white transition-all"
          style={{ background: 'linear-gradient(135deg, #0F4259, #1A7A9A)', boxShadow: '0 4px 12px rgba(15,66,89,0.25)' }}
        >
          Confirm & Route →
        </button>
      </div>
    </div>
  );
}
