import { useEffect, useState } from 'react';
import api from '../../api/client';
import type { BenchmarkResponse, SystemResponse } from '../../types/api';

export function BenchmarkPanel() {
  const [bench,  setBench]  = useState<BenchmarkResponse | null>(null);
  const [sys,    setSys]    = useState<SystemResponse | null>(null);

  useEffect(() => {
    const fetchAll = () => {
      api.get<BenchmarkResponse>('/benchmark').then(r => setBench(r.data)).catch(() => {});
      api.get<SystemResponse>('/system').then(r => setSys(r.data)).catch(() => {});
    };
    fetchAll();
    const id = setInterval(fetchAll, 3_000);
    return () => clearInterval(id);
  }, []);

  const fmt    = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} ms`);
  const fmtGb  = (v: number)        => `${v.toFixed(1)} GB`;
  const fmtPct = (v: number)        => `${v}%`;

  const weather = sys?.weather_alert;
  const gpu     = sys?.gpu_info;

  return (
    <div
      className="fixed bottom-5 right-5 rounded-xl shadow-2xl z-50 overflow-hidden min-w-40"
      style={{ background: 'linear-gradient(135deg, #0A2A3D, #1A3D52)', border: '1px solid rgba(26,147,187,0.3)' }}
    >
      {/* Title strip */}
      <div className="px-3 py-1.5 text-center"
        style={{ background: 'rgba(26,147,187,0.15)', borderBottom: '1px solid rgba(56,174,210,0.2)' }}>
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#72C8E2' }}>
          System
        </span>
      </div>

      {/* Weather alert badge */}
      {weather && (
        <div className="px-3 py-1.5 text-center text-xs font-semibold"
          style={{ background: weather === 'EXTREME_COLD' ? 'rgba(30,64,130,0.5)' : 'rgba(130,60,10,0.5)', color: '#FDE68A' }}>
          {weather === 'EXTREME_COLD' ? '🌨 EXTREME COLD' : '🌡 EXTREME HEAT'}
        </div>
      )}

      <div className="px-3 py-2.5 flex flex-col gap-1.5 font-mono text-xs">
        {/* GPU vs CPU solve times */}
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#38AED2' }} />
            <span style={{ color: '#AADEED' }}>GPU</span>
          </div>
          <span className="font-semibold text-white">{fmt(bench?.last_gpu_ms ?? null)}</span>
        </div>
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4EA086' }} />
            <span style={{ color: '#B4DBCD' }}>CPU</span>
          </div>
          <span className="font-semibold text-white">{fmt(bench?.last_cpu_ms ?? null)}</span>
        </div>
        <div className="flex justify-between items-center gap-3 pb-1.5"
          style={{ borderBottom: '1px solid rgba(56,174,210,0.15)' }}>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#D97706' }} />
            <span style={{ color: '#FDE68A' }}>Speedup</span>
          </div>
          <span className="font-black text-sm" style={{ color: bench?.speedup ? '#FDE68A' : '#506170' }}>
            {bench?.speedup ? `${bench.speedup}×` : '—'}
          </span>
        </div>

        {/* pynvml GPU stats (GX10 only; shows — on MacBook) */}
        <div className="flex justify-between items-center gap-3 pt-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#6366F1' }} />
            <span style={{ color: '#C7D2FE' }}>VRAM</span>
          </div>
          <span style={{ color: 'white' }}>
            {gpu ? `${fmtGb(gpu.vram_used_gb)} / ${fmtGb(gpu.vram_total_gb)}` : '—'}
          </span>
        </div>
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#8B5CF6' }} />
            <span style={{ color: '#DDD6FE' }}>GPU util</span>
          </div>
          <span style={{ color: 'white' }}>
            {gpu ? fmtPct(gpu.gpu_utilization_pct) : '—'}
          </span>
        </div>
        {gpu?.temperature_c != null && (
          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#F59E0B' }} />
              <span style={{ color: '#FDE68A' }}>Temp</span>
            </div>
            <span style={{ color: 'white' }}>{gpu.temperature_c}°C</span>
          </div>
        )}
      </div>
    </div>
  );
}
