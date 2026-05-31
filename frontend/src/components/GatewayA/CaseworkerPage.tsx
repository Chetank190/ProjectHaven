import { useState } from 'react';
import api from '../../api/client';
import type {
  NeedsPayload,
  CaseworkerRouteResponse,
  ItineraryResult,
} from '../../types/api';
import { VoiceInput }          from './VoiceInput';
import { PayloadConfirm }      from './PayloadConfirm';
import { ItineraryView }       from './Itinerary';
import { HandoffScript }       from './HandoffScript';
import { Ticket }              from './Ticket';
import { ShiftBriefing }       from './ShiftBriefing';
import { CaseworkerHistory }   from './CaseworkerHistory';
import { RouteMap }            from './RouteMap';
import { CapacityTicker }      from './CapacityTicker';
import { BenchmarkPanel }      from '../shared/BenchmarkPanel';
import { HavenMatrixLogo }     from '../shared/HavenMatrixLogo';
import { useAuth }             from '../../context/AuthContext';

type Step = 'idle' | 'compiled' | 'confirmed' | 'routed' | 'crisis';

export function CaseworkerPage() {
  const { user, logout }  = useAuth();
  const [step,           setStep]           = useState<Step>('idle');
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [clientName,     setClientName]     = useState('');
  const [payload,        setPayload]        = useState<NeedsPayload | null>(null);
  const [pendingText,    setPendingText]    = useState('');
  const [routeResult,    setRouteResult]    = useState<CaseworkerRouteResponse | null>(null);
  const [handoffTarget,  setHandoffTarget]  = useState<ItineraryResult | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  // caseworker_id comes from JWT when logged in
  const caseworkerId = user?.email ?? '';

  const originLat = 43.6532;
  const originLon = -79.3832;

  const handleTextSubmit = async (text: string) => {
    setLoading(true);
    setError(null);
    setPendingText(text);
    try {
      const r = await api.post<CaseworkerRouteResponse>('/caseworker/route', {
        text,
        origin_lat:    originLat,
        origin_lon:    originLon,
        client_name:   clientName || undefined,
        caseworker_id: caseworkerId || undefined,
      });
      if (r.data.crisis) {
        setRouteResult(r.data);
        setStep('crisis');
        return;
      }
      setPayload(r.data.payload);
      setRouteResult(r.data);
      setStep('compiled');
      if (r.data.case_id) setHistoryRefresh(n => n + 1);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = (confirmed: NeedsPayload) => {
    // Store the caseworker's edits and proceed — the itinerary was already generated
    // from the first route call. Re-posting the same text would produce the same result
    // (the LLM re-compiles from text, not from the confirmed payload), so the round-trip
    // adds latency without changing the itinerary.
    setPayload(confirmed);
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
            <div className="flex items-center gap-3">
              <HavenMatrixLogo size={36} />
              <h1 className="text-xl font-bold tracking-tight">Haven Matrix</h1>
            </div>
            <p className="text-xs mt-0.5 tracking-widest uppercase font-medium"
              style={{ color: 'rgba(114,200,226,0.8)' }}>
              Caseworker Gateway
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <CapacityTicker />

            <input
              type="text"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              placeholder="Client name (optional)"
              className="text-sm px-3 py-2 rounded-lg font-medium transition"
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(56,174,210,0.4)', color: 'white' }}
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
            {/* Signed-in identity + logout */}
            <div className="flex items-center gap-1.5 pl-1" style={{ borderLeft: '1px solid rgba(56,174,210,0.2)' }}>
              <span className="text-xs font-medium" style={{ color: 'rgba(114,200,226,0.7)' }}>
                {user?.name}
              </span>
              <button onClick={logout}
                className="text-xs px-2 py-1 rounded-lg transition"
                style={{ color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.05)' }}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 pb-36 space-y-4">
        <ShiftBriefing />
        {caseworkerId && (
          <CaseworkerHistory caseworkerId={caseworkerId} refreshTrigger={historyRefresh} />
        )}

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

        {step === 'crisis' && routeResult?.crisis && (
          <div className="rounded-2xl p-6 space-y-4"
            style={{ background: '#FFF8E1', border: '2px solid #FBBF24' }}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🆘</span>
              <div>
                <div className="font-bold text-lg" style={{ color: '#92400E' }}>Crisis Detected</div>
                <div className="text-sm font-medium" style={{ color: '#B45309' }}>
                  {routeResult.hotline_name} — {routeResult.crisis_hotline}
                </div>
              </div>
            </div>
            <p className="text-base leading-relaxed" style={{ color: '#1A2330' }}>
              {routeResult.escalation_text}
            </p>
            <div className="flex gap-3">
              <a href={`tel:${routeResult.crisis_hotline}`}
                className="font-bold px-5 py-2.5 rounded-xl text-white text-base transition"
                style={{ background: '#D97706' }}>
                Call {routeResult.crisis_hotline}
              </a>
              <button onClick={reset}
                className="font-medium px-5 py-2.5 rounded-xl text-sm transition"
                style={{ background: '#FDE68A', color: '#92400E', border: '1px solid #FBBF24' }}>
                New Client
              </button>
            </div>
          </div>
        )}

        {/* Returning client hint — shown as soon as routing completes */}
        {routeResult?.returning_hint && (
          <div className="rounded-xl px-4 py-3 flex items-start gap-3"
            style={{ background: '#EDE9FE', border: '1px solid #C4B5FD' }}>
            <span className="text-lg flex-shrink-0">🔁</span>
            <div className="text-sm" style={{ color: '#4C1D95' }}>
              <span className="font-bold">Possible returning client</span>
              {routeResult.returning_hint.client_name && (
                <> — last seen as <b>{routeResult.returning_hint.client_name}</b></>
              )}
              {' '}on <b>{routeResult.returning_hint.last_seen}</b>
              {routeResult.returning_hint.placed_at && (
                <>, routed to <b>{routeResult.returning_hint.placed_at}</b></>
              )}
              , outcome: <b>{routeResult.returning_hint.outcome}</b>
              <span className="ml-2 text-xs opacity-60">
                ({Math.round(routeResult.returning_hint.similarity * 100)}% match)
              </span>
            </div>
          </div>
        )}

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
              {routeResult.cpu_solve_ms != null && (
                <span className="px-2.5 py-1 rounded-md font-mono" style={{ background: '#E9EDF0', color: '#506170' }}>
                  CPU {routeResult.cpu_solve_ms.toFixed(1)} ms
                </span>
              )}
              {routeResult.speedup && (
                <span className="px-2.5 py-1 rounded-md font-semibold"
                  style={{ background: '#D9EDE6', color: '#1D4238' }}>
                  {routeResult.speedup}× speedup
                </span>
              )}
            </div>

            <RouteMap itinerary={routeResult.itinerary} originLat={originLat} originLon={originLon} />
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
