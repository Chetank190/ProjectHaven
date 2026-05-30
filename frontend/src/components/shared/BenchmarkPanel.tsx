import { useEffect, useState } from 'react';
import api from '../../api/client';
import type { BenchmarkResponse } from '../../types/api';

export function BenchmarkPanel() {
  const [data, setData] = useState<BenchmarkResponse | null>(null);

  useEffect(() => {
    const fetch = () =>
      api.get<BenchmarkResponse>('/benchmark').then(r => setData(r.data)).catch(() => {});
    fetch();
    const id = setInterval(fetch, 3_000);
    return () => clearInterval(id);
  }, []);

  const fmt = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} ms`);

  return (
    <div className="fixed bottom-4 right-4 rounded-xl shadow-2xl z-50 overflow-hidden min-w-44"
      style={{ background: 'linear-gradient(135deg, #0A2A3D, #1A3D52)', border: '1px solid rgba(26,147,187,0.3)' }}>
      <div className="px-3 py-1.5 text-center"
        style={{ background: 'rgba(26,147,187,0.15)', borderBottom: '1px solid rgba(56,174,210,0.2)' }}>
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#72C8E2' }}>GPU vs CPU</span>
      </div>
      <div className="px-3 py-2.5 flex flex-col gap-1.5 font-mono text-xs">
        <div className="flex justify-between items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#38AED2' }} />
            <span style={{ color: '#AADEED' }}>GPU</span>
          </div>
          <span className="font-semibold text-white">{fmt(data?.last_gpu_ms ?? null)}</span>
        </div>
        <div className="flex justify-between items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4EA086' }} />
            <span style={{ color: '#B4DBCD' }}>CPU</span>
          </div>
          <span className="font-semibold text-white">{fmt(data?.last_cpu_ms ?? null)}</span>
        </div>
        <div className="flex justify-between items-center gap-4 pt-1.5"
          style={{ borderTop: '1px solid rgba(56,174,210,0.15)' }}>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#D97706' }} />
            <span style={{ color: '#FDE68A' }}>Speedup</span>
          </div>
          <span className="font-black text-sm" style={{ color: data?.speedup ? '#FDE68A' : '#506170' }}>
            {data?.speedup ? `${data.speedup}×` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}
