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
        facility_name: facilityName, facility_phone: facilityPhone, payload,
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
      style={{ background: 'rgba(10,42,61,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl overflow-hidden shadow-2xl max-w-lg w-full"
        style={{ background: 'white', border: '1px solid #AADEED' }}>

        {/* Modal header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #0A2A3D, #1A7A9A)' }}>
          <div>
            <div className="text-white font-semibold text-sm">Phone Script</div>
            <div className="text-xs mt-0.5" style={{ color: '#72C8E2' }}>{facilityName}</div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}>
            ✕
          </button>
        </div>

        <div className="p-5">
          {!script && !loading && (
            <button onClick={generate}
              className="w-full font-semibold py-3 rounded-xl text-sm text-white"
              style={{ background: 'linear-gradient(135deg, #0F4259, #1A7A9A)', boxShadow: '0 4px 12px rgba(15,66,89,0.25)' }}>
              Generate Phone Script
            </button>
          )}
          {loading && (
            <div className="text-center py-10">
              <svg className="w-8 h-8 mx-auto mb-3 animate-spin" style={{ color: '#1A7A9A' }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              <p className="text-sm" style={{ color: '#506170' }}>Generating script…</p>
            </div>
          )}
          {script && (
            <>
              <div className="rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap font-mono"
                style={{ background: '#F5F7F8', border: '1px solid #D0D8DE', color: '#1A2330' }}>
                {script}
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={copy}
                  className="flex-1 font-semibold py-2.5 rounded-xl text-sm text-white transition-all"
                  style={copied
                    ? { background: '#2E6E59' }
                    : { background: 'linear-gradient(135deg, #255748, #3A8A71)', boxShadow: '0 4px 10px rgba(37,87,72,0.25)' }
                  }>
                  {copied ? '✓ Copied to clipboard' : '📋 Copy Script'}
                </button>
                <button onClick={generate}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: '#D5EFF5', color: '#155F79', border: '1px solid #AADEED' }}>
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
