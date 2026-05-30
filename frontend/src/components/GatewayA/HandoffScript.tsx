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
  const [script, setScript] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied]   = useState(false);

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Phone Script — {facilityName}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {!script && !loading && (
          <button
            onClick={generate}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition"
          >
            Generate Script
          </button>
        )}

        {loading && (
          <div className="text-center py-8 text-gray-500">Generating phone script…</div>
        )}

        {script && (
          <>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">
              {script}
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={copy}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-xl transition"
              >
                {copied ? '✓ Copied!' : 'Copy Script'}
              </button>
              <button
                onClick={generate}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-2 rounded-xl transition"
              >
                Regenerate
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
