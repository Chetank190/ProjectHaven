import { useEffect, useState } from 'react';
import api from '../../api/client';
import type { BenchmarkResponse } from '../../types/api';

export function BenchmarkPanel() {
  const [data, setData] = useState<BenchmarkResponse | null>(null);

  useEffect(() => {
    const fetch = () =>
      api.get<BenchmarkResponse>('/benchmark')
        .then(r => setData(r.data))
        .catch(() => {});
    fetch();
    const id = setInterval(fetch, 3_000);
    return () => clearInterval(id);
  }, []);

  const fmt = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} ms`);

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-white rounded-xl p-4 shadow-2xl min-w-48 z-50 border border-gray-700">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        GPU vs CPU
      </div>
      <div className="flex flex-col gap-1 text-sm font-mono">
        <div className="flex justify-between gap-4">
          <span className="text-green-400">GPU</span>
          <span>{fmt(data?.last_gpu_ms ?? null)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-blue-400">CPU</span>
          <span>{fmt(data?.last_cpu_ms ?? null)}</span>
        </div>
        <div className="border-t border-gray-700 mt-1 pt-1 flex justify-between gap-4">
          <span className="text-yellow-400">Speedup</span>
          <span className="font-bold text-yellow-300">
            {data?.speedup ? `${data.speedup}×` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}
