import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';
import type { CaseRecord, CaseOutcome, CaseworkerHistoryResponse } from '../../types/api';

interface Props {
  caseworkerId: string;
  refreshTrigger: number;   // increment to force a reload after a new route
}

const OUTCOME_LABELS: Record<CaseOutcome, string> = {
  pending:             'Pending',
  placed:              'Placed',
  declined:            'Declined',
  returned:            'Returned',
  referred_elsewhere:  'Referred Elsewhere',
};

const OUTCOME_COLORS: Record<CaseOutcome, { bg: string; text: string; border: string }> = {
  pending:            { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
  placed:             { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  declined:           { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  returned:           { bg: '#EDE9FE', text: '#4C1D95', border: '#C4B5FD' },
  referred_elsewhere: { bg: '#E0F2FE', text: '#0C4A6E', border: '#7DD3FC' },
};

function needsIcons(needs: CaseRecord['needs']): string[] {
  if (!needs) return [];
  const icons: string[] = [];
  if (needs.needs_shelter)       icons.push('🏠');
  if (needs.needs_food)          icons.push('🍽');
  if (needs.needs_hygiene)       icons.push('🚿');
  if (needs.needs_rehab)         icons.push('💊');
  if (needs.needs_respite)       icons.push('🛋');
  if (needs.needs_youth_service) icons.push('🎓');
  if (needs.needs_supplies)      icons.push('📦');
  if (needs.needs_library)       icons.push('📚');
  return icons;
}

function firstPlacement(itinerary: CaseRecord['itinerary']): string {
  if (!itinerary) return '—';
  for (const pillar of ['shelter', 'respite', 'rehab', 'food', 'hygiene']) {
    const results = (itinerary as Record<string, {name:string}[]>)[pillar];
    if (results && results.length > 0) return results[0].name;
  }
  return '—';
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'Z').toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return iso.slice(0, 10); }
}

export function CaseworkerHistory({ caseworkerId, refreshTrigger }: Props) {
  const [cases,     setCases]     = useState<CaseRecord[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [open,      setOpen]      = useState(false);
  const [updating,  setUpdating]  = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseworkerId) return;
    setLoading(true);
    try {
      const r = await api.get<CaseworkerHistoryResponse>(
        `/caseworker/${encodeURIComponent(caseworkerId)}/history`
      );
      setCases(r.data.cases);
    } catch {
      // silently ignore — history is non-critical
    } finally {
      setLoading(false);
    }
  }, [caseworkerId]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const setOutcome = async (caseId: string, outcome: CaseOutcome) => {
    setUpdating(caseId);
    try {
      await api.patch(`/case/${caseId}/outcome`, { outcome });
      setCases(prev => prev.map(c => c.id === caseId ? { ...c, outcome } : c));
    } catch {
      // ignore
    } finally {
      setUpdating(null);
    }
  };

  if (!caseworkerId) return null;

  const colors = { bg: '#F5F7F8', header: 'linear-gradient(135deg, #0A2A3D, #0F4259)' };

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: '1px solid #D0D8DE' }}>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 transition-all"
        style={{ background: colors.header, color: 'white' }}
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" style={{ color: 'rgba(114,200,226,0.8)' }} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
          </svg>
          <span className="text-sm font-semibold tracking-widest uppercase" style={{ color: 'rgba(114,200,226,0.9)' }}>
            My Cases
          </span>
          {cases.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-bold"
              style={{ background: 'rgba(26,147,187,0.35)', color: '#72C8E2' }}>
              {cases.length}
            </span>
          )}
        </div>
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'rgba(114,200,226,0.6)' }} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>

      {open && (
        <div style={{ background: colors.bg }}>
          {loading && (
            <div className="px-5 py-6 text-center text-sm" style={{ color: '#8A9BAA' }}>
              Loading history…
            </div>
          )}

          {!loading && cases.length === 0 && (
            <div className="px-5 py-6 text-center text-sm" style={{ color: '#8A9BAA' }}>
              No cases yet — routed clients will appear here.
            </div>
          )}

          {!loading && cases.length > 0 && (
            <div className="divide-y" style={{ borderColor: '#E2E8EC' }}>
              {cases.map(c => {
                const oc = OUTCOME_COLORS[c.outcome];
                const isExpanded = expanded === c.id;
                const icons = needsIcons(c.needs);
                const placement = firstPlacement(c.itinerary);

                return (
                  <div key={c.id} className="px-5 py-3">
                    {/* Row summary */}
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold" style={{ color: '#1A2330' }}>
                            {c.client_name || 'Anonymous'}
                          </span>
                          <span className="text-xs" style={{ color: '#8A9BAA' }}>
                            {fmtDate(c.created_at)}
                          </span>
                          {icons.length > 0 && (
                            <span className="text-sm">{icons.join(' ')}</span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5 truncate" style={{ color: '#506170' }}>
                          → {placement}
                        </div>
                      </div>

                      {/* Outcome badge + selector */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: oc.bg, color: oc.text, border: `1px solid ${oc.border}` }}>
                          {OUTCOME_LABELS[c.outcome]}
                        </span>
                        <button
                          onClick={() => setExpanded(isExpanded ? null : c.id)}
                          className="text-xs px-2 py-1 rounded-lg transition"
                          style={{ background: '#E9EDF0', color: '#506170' }}
                        >
                          {isExpanded ? 'Close' : 'Detail'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="mt-3 space-y-3">
                        {/* Transcript excerpt */}
                        <div className="rounded-xl p-3 text-xs leading-relaxed"
                          style={{ background: '#EFF9FB', border: '1px solid #AADEED', color: '#1A2330' }}>
                          <span className="font-semibold" style={{ color: '#155F79' }}>Notes: </span>
                          {c.transcript.slice(0, 300)}{c.transcript.length > 300 ? '…' : ''}
                        </div>

                        {/* Top placements */}
                        {c.itinerary && Object.keys(c.itinerary).length > 0 && (
                          <div className="text-xs space-y-1">
                            {Object.entries(c.itinerary as Record<string, {name:string; address:string}[]>)
                              .filter(([, v]) => v.length > 0)
                              .map(([pillar, results]) => (
                                <div key={pillar} className="flex gap-2">
                                  <span className="font-semibold capitalize w-16 flex-shrink-0" style={{ color: '#0F4259' }}>
                                    {pillar}
                                  </span>
                                  <span style={{ color: '#506170' }}>{results[0].name}</span>
                                </div>
                              ))
                            }
                          </div>
                        )}

                        {/* Outcome updater */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium" style={{ color: '#506170' }}>Mark outcome:</span>
                          {(['placed', 'declined', 'returned', 'referred_elsewhere'] as CaseOutcome[]).map(o => {
                            const col = OUTCOME_COLORS[o];
                            const isActive = c.outcome === o;
                            return (
                              <button
                                key={o}
                                disabled={updating === c.id}
                                onClick={() => setOutcome(c.id, o)}
                                className="text-xs px-2.5 py-1 rounded-full font-medium transition"
                                style={{
                                  background: isActive ? col.bg : '#E9EDF0',
                                  color:      isActive ? col.text : '#506170',
                                  border:     isActive ? `1px solid ${col.border}` : '1px solid transparent',
                                  opacity:    updating === c.id ? 0.5 : 1,
                                }}
                              >
                                {OUTCOME_LABELS[o]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
