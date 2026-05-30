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
  const [step,         setStep]         = useState<Step>('idle');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [clientName,   setClientName]   = useState('');
  const [payload,      setPayload]      = useState<NeedsPayload | null>(null);
  const [pendingText,  setPendingText]  = useState('');
  const [routeResult,  setRouteResult]  = useState<CaseworkerRouteResponse | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<ItineraryResult | null>(null);

  const originLat = 43.6532;
  const originLon = -79.3832;

  const handleTextSubmit = async (text: string) => {
    setLoading(true);
    setError(null);
    setPendingText(text);
    try {
      // Preview the payload before routing
      const r = await api.post<CaseworkerRouteResponse>('/caseworker/route', {
        text,
        origin_lat: originLat,
        origin_lon: originLon,
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
    // If payload changed, re-route with confirmed payload
    if (JSON.stringify(confirmed) !== JSON.stringify(payload)) {
      setLoading(true);
      try {
        const r = await api.post<CaseworkerRouteResponse>('/caseworker/route', {
          text: pendingText,
          origin_lat: originLat,
          origin_lon: originLon,
          client_name: clientName || undefined,
        });
        setRouteResult(r.data);
      } catch {
        // Keep existing route result on re-route failure
      } finally {
        setLoading(false);
      }
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-blue-700 text-white px-6 py-4 shadow">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Haven Matrix</h1>
            <p className="text-blue-200 text-sm">Caseworker Gateway</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              placeholder="Client name (optional)"
              className="text-sm px-3 py-1.5 rounded-lg bg-white/20 text-white placeholder-blue-200 border border-blue-500 focus:outline-none focus:ring-2 focus:ring-white"
            />
            {step !== 'idle' && (
              <button onClick={reset} className="text-sm bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg transition">
                New Client
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 space-y-4">
        {/* Shift briefing always visible */}
        <ShiftBriefing />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
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
            {/* Latency info strip */}
            <div className="text-xs text-gray-400 flex gap-4">
              <span>Method: <strong>{routeResult.compile_method.toUpperCase()}</strong></span>
              <span>NIM: {routeResult.nim_latency_ms.toFixed(0)} ms</span>
              <span>GPU solve: {routeResult.gpu_solve_ms.toFixed(1)} ms</span>
              <span>CPU solve: {routeResult.cpu_solve_ms.toFixed(1)} ms</span>
              {routeResult.speedup && <span className="text-green-600 font-bold">Speedup: {routeResult.speedup}×</span>}
            </div>

            <ItineraryView
              itinerary={routeResult.itinerary}
              onHandoff={result => setHandoffTarget(result)}
            />

            <Ticket ticketText={routeResult.ticket_text} clientName={clientName} />
          </>
        )}
      </main>

      {/* Handoff script modal */}
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
