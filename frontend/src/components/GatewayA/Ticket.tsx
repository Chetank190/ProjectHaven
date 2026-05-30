import { useState } from 'react';

interface Props {
  ticketText:  string;
  clientName?: string;
}

export function Ticket({ ticketText, clientName }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(ticketText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #3D2228' }}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'linear-gradient(135deg, #1A0E10, #3D2228)' }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#B87333' }} />
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#FAEFD4' }}>
            Care Ticket{clientName ? ` · ${clientName}` : ''}
          </span>
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
          style={copied
            ? { background: '#065F46', color: '#D1FADF' }
            : { background: 'rgba(184,115,51,0.25)', color: '#EDC36C', border: '1px solid rgba(184,115,51,0.4)' }
          }
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>

      {/* Ticket body */}
      <div className="px-4 py-3" style={{ background: '#231316' }}>
        <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono" style={{ color: '#EDC36C' }}>
          {ticketText}
        </pre>
      </div>
    </div>
  );
}
