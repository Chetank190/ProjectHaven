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
    <div className="bg-gray-900 text-green-400 rounded-xl p-4 font-mono text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400 text-xs uppercase tracking-wide">
          Care Ticket{clientName ? ` — ${clientName}` : ''}
        </span>
        <button
          onClick={copy}
          className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded-lg transition"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="whitespace-pre-wrap text-green-300 leading-relaxed">{ticketText}</pre>
    </div>
  );
}
