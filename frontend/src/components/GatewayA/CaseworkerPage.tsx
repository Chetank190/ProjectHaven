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
        setStep('routed');
      } catch {
        setError('Re-route failed. Showing previous results.');
        setStep('routed');
      } finally {
        setLoading(false);
      }
      return;
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
    <div className="min-h-screen flex flex-col" style={{ background: '#F5F7F8' }}>

      {/* Header — professional deep teal */}
      <header style={{ background: 'linear-gradient(135deg, #0A2A3D 0%, #0F4259 50%, #1A7A9A 100%)' }}
        className="text-white px-6 py-4 shadow-lg">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              {/* Shield / Haven mark */}
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(26,147,187,0.3)', border: '1px solid rgba(56,174,210,0.5)' }}>
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clipRule="evenodd"/>
                </svg>
              </div>
              <h1 className="text-xl font-bold tracking-tight">Haven Matrix</h1>
            </div>
            <p className="text-xs mt-0.5 tracking-widest uppercase font-medium"
              style={{ color: 'rgba(114,200,226,0.8)' }}>
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
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(56,174,210,0.4)',
                color: 'white',
              }}
            />
            {step !== 'idle' && (
              <button
                onClick={reset}
                className="text-sm font-semibold px-4 py-2 rounded-lg transition"
                style={{ background: 'rgba(26,147,187,0.25)', border: '1px solid rgba(56,174,210,0.4)', color: '#AADEED' }}
              >
                + New Client
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 pb-36 space-y-4">
        <ShiftBriefing />

        {error && (
          <div className="rounded-xl p-4 text-sm font-medium flex items-start gap-2"
            style={{ background: '#FEF3C7', border: '1px solid #FBBF24', color: '#92400E' }}>
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            {error}
          </div>
        )}

        {step === 'idle'     && <VoiceInput onSubmit={handleTextSubmit} loading={loading} />}
        {step === 'compiled' && payload && <PayloadConfirm payload={payload} onConfirm={handleConfirm} />}

        {step === 'routed' && routeResult && (
          <>
            {/* Latency strip */}
            <div className="flex flex-wrap gap-2 text-xs px-1">
              <span className="px-2.5 py-1 rounded-md font-semibold"
                style={{ background: '#D5EFF5', color: '#0F4259' }}>
                {routeResult.compile_method.toUpperCase()}
              </span>
              <span className="px-2.5 py-1 rounded-md font-mono" style={{ background: '#E9EDF0', color: '#506170' }}>
                NIM {routeResult.nim_latency_ms.toFixed(0)} ms
              </span>
              <span className="px-2.5 py-1 rounded-md font-mono" style={{ background: '#E9EDF0', color: '#506170' }}>
                GPU {routeResult.gpu_solve_ms.toFixed(1)} ms
              </span>
              <span className="px-2.5 py-1 rounded-md font-mono" style={{ background: '#E9EDF0', color: '#506170' }}>
                CPU {routeResult.cpu_solve_ms.toFixed(1)} ms
              </span>
              {routeResult.speedup && (
                <span className="px-2.5 py-1 rounded-md font-semibold"
                  style={{ background: '#D9EDE6', color: '#1D4238' }}>
                  {routeResult.speedup}× speedup
                </span>
              )}
            </div>

            <ItineraryView itinerary={routeResult.itinerary} onHandoff={r => setHandoffTarget(r)} />
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
