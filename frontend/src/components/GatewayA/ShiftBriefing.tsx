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
    <div className="mb-4">
      <button
        onClick={open ? () => setOpen(false) : generate}
        disabled={loading}
        className="text-sm bg-amber-100 hover:bg-amber-200 text-amber-800 font-medium px-4 py-2 rounded-lg transition disabled:opacity-50"
      >
        {loading ? 'Generating briefing…' : open ? '▼ Hide Shift Briefing' : '▶ Generate Shift Briefing'}
      </button>

      {open && text && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}
