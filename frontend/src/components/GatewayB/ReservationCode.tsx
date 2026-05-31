import { useEffect } from 'react';
import { useSpeech } from '../shared/useSpeech';
import { HavenMatrixLogo } from '../shared/HavenMatrixLogo';
import type { KioskReserveResponse } from '../../types/api';

interface Props {
  reservation: KioskReserveResponse;
  onReset:     () => void;
}

function formatExpiry(isoStr: string): string {
  try {
    const d = new Date(isoStr + 'Z');
    return d.toLocaleString('en-CA', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return isoStr;
  }
}

export function ReservationCode({ reservation, onReset }: Props) {
  const { speak, stopSpeaking } = useSpeech();

  useEffect(() => {
    const msg =
      `Your reservation is confirmed. ` +
      `Your code is ${reservation.code.split('').join(' ')}. ` +
      `Go to ${reservation.facility_name} and say this code when you arrive. ` +
      `You can print this page now.`;
    speak(msg);
    return () => stopSpeaking();
  }, []);

  const handlePrint = () => window.print();

  return (
    <>
      {/* Print-only reset — hides everything else when printing */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #reservation-printable, #reservation-printable * { visibility: visible; }
          #reservation-printable {
            position: fixed; inset: 0;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            background: white; color: black;
            font-family: monospace;
            padding: 40px;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 py-10 text-center"
        style={{ background: 'linear-gradient(160deg, #0A1E2E 0%, #0D2436 60%, #061825 100%)' }}
      >
        <div id="reservation-printable" className="w-full max-w-lg">

          {/* Logo + wordmark */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <HavenMatrixLogo size={24} />
            <span className="text-sm font-medium tracking-widest uppercase"
              style={{ color: 'rgba(114,200,226,0.6)' }}>
              Haven Matrix
            </span>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-light mb-2" style={{ color: 'rgba(114,200,226,0.9)' }}>
            Reservation Confirmed
          </h1>
          <p className="text-base mb-8" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Show this code when you arrive
          </p>

          {/* Code card */}
          <div className="rounded-3xl py-10 px-8 mb-6"
            style={{
              background: 'rgba(26,147,187,0.10)',
              border: '2px solid rgba(56,174,210,0.45)',
              boxShadow: '0 0 40px rgba(26,147,187,0.20)',
            }}>
            <div
              className="font-mono font-bold tracking-[0.25em] mb-3"
              style={{ fontSize: '3.5rem', color: '#72C8E2', letterSpacing: '0.3em' }}
            >
              {reservation.code}
            </div>
            <div className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(114,200,226,0.45)' }}>
              Reservation Code
            </div>
          </div>

          {/* Facility info */}
          <div className="rounded-2xl py-5 px-6 mb-6 text-left"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2"
              style={{ color: 'rgba(114,200,226,0.5)' }}>
              {reservation.pillar}
            </p>
            <p className="text-2xl font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.95)' }}>
              {reservation.facility_name}
            </p>
            <p className="text-base" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {reservation.facility_address}
            </p>
          </div>

          {/* Expiry */}
          <p className="text-sm mb-8" style={{ color: 'rgba(255,255,255,0.30)' }}>
            Valid until {formatExpiry(reservation.expires_at)} · 24-hour hold
          </p>

          {/* Action buttons */}
          <div className="flex flex-col gap-3 no-print">
            <button
              onClick={handlePrint}
              className="w-full py-4 rounded-2xl text-lg font-medium transition-all"
              style={{
                background: 'linear-gradient(135deg, #1A7A9A, #38AED2)',
                color: 'white',
              }}
            >
              Print this page
            </button>

            <button
              onClick={onReset}
              className="w-full py-4 rounded-2xl text-base font-light transition-all"
              style={{
                color: 'rgba(114,200,226,0.45)',
                border: '1px solid rgba(26,147,187,0.18)',
                background: 'rgba(26,147,187,0.04)',
              }}
            >
              Done — start over
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
