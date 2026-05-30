import { useState } from 'react';
import api from '../../api/client';
import type { NeedsPayload, HandoffResponse } from '../../types/api';

interface Props {
  facilityName:  string;
  facilityPhone: string;
  payload:       NeedsPayload;
  onClose:       () => void;
}

export function HandoffScript({ facilityName, facilityPhone, payload, onClose }: Props) {
  const [script,  setScript]  = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied,  setCopied]  = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const r = await api.post<HandoffResponse>('/handoff-script', {
        facility_name:  facilityName,
        facility_phone: facilityPhone,
        payload,
      });
      setScript(r.data.script);
    } catch {
      setScript('Could not generate script. Compose manually using the client needs above.');
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (script) {
      navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(61,11,21,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl overflow-hidden shadow-2xl max-w-lg w-full"
        style={{ background: 'white', border: '1px solid #F4B0BB' }}>

        {/* Modal header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #3D0B15, #7D1A2A)' }}>
          <div>
            <div className="text-white font-semibold text-sm">Phone Script</div>
            <div className="text-xs mt-0.5" style={{ color: '#F4B0BB' }}>{facilityName}</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition"
            style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {!script && !loading && (
            <button
              onClick={generate}
              className="w-full font-semibold py-3 rounded-xl text-sm text-white transition-all"
              style={{ background: 'linear-gradient(135deg, #7D1A2A, #C23B52)', boxShadow: '0 4px 12px rgba(155,35,53,0.3)' }}
            >
              Generate Phone Script
            </button>
          )}

          {loading && (
            <div className="text-center py-10">
              <svg className="w-8 h-8 mx-auto mb-3 animate-spin" style={{ color: '#9B2335' }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              <p className="text-sm" style={{ color: '#7A5C54' }}>Generating phone script…</p>
            </div>
          )}

          {script && (
            <>
              <div className="rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap font-mono"
                style={{ background: '#FDF6F3', border: '1px solid #EDD5CC', color: '#2C1518' }}>
                {script}
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={copy}
                  className="flex-1 font-semibold py-2.5 rounded-xl text-sm text-white transition-all"
                  style={copied
                    ? { background: '#065F46', boxShadow: 'none' }
                    : { background: 'linear-gradient(135deg, #B44A1F, #C85D30)', boxShadow: '0 4px 10px rgba(180,74,31,0.3)' }
                  }
                >
                  {copied ? '✓ Copied to clipboard' : '📋 Copy Script'}
                </button>
                <button
                  onClick={generate}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold transition"
                  style={{ background: '#FAD9DE', color: '#7D1A2A', border: '1px solid #F4B0BB' }}
                >
                  Regenerate
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
