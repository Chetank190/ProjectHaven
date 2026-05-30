import { useState } from 'react';
import api from '../../api/client';
import type { BriefingResponse } from '../../types/api';

export function ShiftBriefing() {
  const [text,    setText]    = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const r = await api.post<BriefingResponse>('/caseworker/briefing', {
        current_time_iso: new Date().toISOString(),
      });
      setText(r.data.briefing_text);
      setOpen(true);
    } catch {
      setText('Briefing unavailable. Check shelter data manually.');
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #F5DCA4' }}>
      <button
        onClick={open ? () => setOpen(false) : generate}
        disabled={loading}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold transition-all disabled:opacity-60"
        style={{ background: 'linear-gradient(90deg, #FAEFD4, #FDF8EE)', color: '#7A491E' }}
      >
        <svg className="w-4 h-4 flex-shrink-0" style={{ color: '#B87333' }} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h7a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/>
        </svg>
        {loading ? 'Generating briefing…' : open ? '▼ Hide Shift Briefing' : '▶ Morning Shift Briefing'}
      </button>

      {open && text && (
        <div className="px-4 py-3 text-sm leading-relaxed" style={{ background: '#FDF8EE', color: '#5A3515', borderTop: '1px solid #F5DCA4' }}>
          {text}
        </div>
      )}
    </div>
  );
}
