import { useState } from 'react';
import api from '../../api/client';
import type {
  NeedsPayload,
  CaseworkerRouteResponse,
  ItineraryResult,
} from '../../types/api';
import { VoiceInput }     from './VoiceInput';
import { PayloadConfirm } from './PayloadConfirm';
import { ItineraryView }  from './Itinerary';
import { HandoffScript }  from './HandoffScript';
import { Ticket }         from './Ticket';
import { ShiftBriefing }  from './ShiftBriefing';
import { BenchmarkPanel } from '../shared/BenchmarkPanel';

type Step = 'idle' | 'compiled' | 'confirmed' | 'routed';

export function CaseworkerPage() {
  const [step,          setStep]          = useState<Step>('idle');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [clientName,    setClientName]    = useState('');
  const [payload,       setPayload]       = useState<NeedsPayload | null>(null);
  const [pendingText,   setPendingText]   = useState('');
  const [routeResult,   setRouteResult]   = useState<CaseworkerRouteResponse | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<ItineraryResult | null>(null);

  const originLat = 43.6532;
  const originLon = -79.3832;

  const handleTextSubmit = async (text: string) => {
    setLoading(true);
    setError(null);
    setPendingText(text);
    try {
      const r = await api.post<CaseworkerRouteResponse>('/caseworker/route', {
        text,
        origin_lat:  originLat,
        origin_lon:  originLon,
        client_name: clientName || undefined,
      });
      setPayload(r.data.payload);
      setRouteResult(r.data);
      setStep('compiled');
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (confirmed: NeedsPayload) => {
    if (JSON.stringify(confirmed) !== JSON.stringify(payload)) {
      setLoading(true);
      try {
        const r = await api.post<CaseworkerRouteResponse>('/caseworker/route', {
          text:        pendingText,
          origin_lat:  originLat,
          origin_lon:  originLon,
          client_name: clientName || undefined,
        });
        setRouteResult(r.data);
      } catch { /* keep existing result */ }
      finally { setLoading(false); }
    }
    setStep('routed');
  };

  const reset = () => {
    setStep('idle');
    setPayload(null);
    setRouteResult(null);
    setError(null);
    setHandoffTarget(null);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(160deg, #FDF6F3 0%, #F5EAE5 100%)' }}>

      {/* Header */}
      <header style={{ background: 'linear-gradient(135deg, #3D0B15 0%, #7D1A2A 50%, #9B2335 100%)' }}
        className="text-white px-6 py-4 shadow-xl">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              {/* Logo mark */}
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(184,115,51,0.3)', border: '1px solid rgba(184,115,51,0.5)' }}>
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2L14 6v4l-6 4L2 10V6z" fill="#B87333" opacity="0.9"/>
                  <path d="M8 2L14 6l-6 4L2 6z" fill="#D4A53A" opacity="0.6"/>
                </svg>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Haven Matrix</h1>
            </div>
            <p className="text-xs mt-0.5 font-medium tracking-wider uppercase"
              style={{ color: 'rgba(212,165,58,0.8)' }}>
              Caseworker Gateway
            </p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              placeholder="Client name (optional)"
              className="text-sm px-3 py-2 rounded-lg font-medium transition"
              style={{
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(212,165,58,0.4)',
                color: 'white',
              }}
            />
            {step !== 'idle' && (
              <button
                onClick={reset}
                className="text-sm font-semibold px-4 py-2 rounded-lg transition"
                style={{ background: 'rgba(184,115,51,0.25)', border: '1px solid rgba(184,115,51,0.5)', color: '#F5DCA4' }}
              >
                + New Client
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 space-y-4">
        <ShiftBriefing />

        {error && (
          <div className="rounded-xl p-4 text-sm font-medium"
            style={{ background: '#FAD9DE', border: '1px solid #F4B0BB', color: '#5E1220' }}>
            ⚠ {error}
          </div>
        )}

        {step === 'idle' && (
          <VoiceInput onSubmit={handleTextSubmit} loading={loading} />
        )}

        {step === 'compiled' && payload && (
          <PayloadConfirm payload={payload} onConfirm={handleConfirm} />
        )}

        {step === 'routed' && routeResult && (
          <>
            {/* Latency strip */}
            <div className="flex flex-wrap gap-3 text-xs font-mono px-1">
              <span className="px-2 py-1 rounded-md font-semibold"
                style={{ background: '#FAD9DE', color: '#7D1A2A' }}>
                {routeResult.compile_method.toUpperCase()}
              </span>
              <span style={{ color: '#7A5C54' }}>NIM {routeResult.nim_latency_ms.toFixed(0)} ms</span>
              <span style={{ color: '#7A5C54' }}>GPU {routeResult.gpu_solve_ms.toFixed(1)} ms</span>
              <span style={{ color: '#7A5C54' }}>CPU {routeResult.cpu_solve_ms.toFixed(1)} ms</span>
              {routeResult.speedup && (
                <span className="font-bold px-2 py-1 rounded-md"
                  style={{ background: '#FAEFD4', color: '#7A491E' }}>
                  {routeResult.speedup}× speedup
                </span>
              )}
            </div>

            <ItineraryView
              itinerary={routeResult.itinerary}
              onHandoff={result => setHandoffTarget(result)}
            />

            <Ticket ticketText={routeResult.ticket_text} clientName={clientName} />
          </>
        )}
      </main>

      {handoffTarget && payload && (
        <HandoffScript
          facilityName={handoffTarget.name}
          facilityPhone={handoffTarget.phone}
          payload={payload}
          onClose={() => setHandoffTarget(null)}
        />
      )}

      <BenchmarkPanel />
    </div>
  );
}
