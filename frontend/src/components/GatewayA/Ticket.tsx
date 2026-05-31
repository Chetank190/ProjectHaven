import { useState } from 'react';

interface Props {
  ticketText:  string;
  clientName?: string;
}

export function Ticket({ ticketText, clientName }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(ticketText)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {
        // Clipboard blocked (HTTP or permissions denied) — silent fail, copy button stays normal
      });
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #2A3540' }}>
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'linear-gradient(135deg, #0F1720, #1A2330)' }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#38AED2' }} />
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#72C8E2' }}>
            Care Ticket{clientName ? ` · ${clientName}` : ''}
          </span>
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
          style={copied
            ? { background: '#255748', color: '#80C0AA' }
            : { background: 'rgba(26,147,187,0.2)', color: '#72C8E2', border: '1px solid rgba(56,174,210,0.3)' }
          }
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <div className="px-4 py-3" style={{ background: '#1A2330' }}>
        <pre className="whitespace-pre-wrap text-xs leading-relaxed font-mono" style={{ color: '#72C8E2' }}>
          {ticketText}
        </pre>
      </div>
    </div>
  );
}
