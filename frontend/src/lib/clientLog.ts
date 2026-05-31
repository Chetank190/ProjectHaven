/**
 * Structured browser logger.
 * - Writes a tagged JSON line to the browser console (always)
 * - Ships the event to /api/v1/client-log so it lands in the server log file
 *   alongside backend events for end-to-end session analysis.
 *
 * Fire-and-forget — never throws, never blocks the calling code.
 */

const SESSION_ID = Math.random().toString(36).slice(2, 10);

type Level = 'debug' | 'info' | 'warn' | 'error';

export function clientLog(
  event: string,
  data?: Record<string, unknown>,
  level: Level = 'info',
): void {
  // Console output — visible in Chrome DevTools
  const entry = { ts: new Date().toISOString(), session: SESSION_ID, event, ...data };
  if (level === 'error')       console.error('[Haven]', event, entry);
  else if (level === 'warn')   console.warn('[Haven]', event, entry);
  else if (level === 'debug')  console.debug('[Haven]', event, entry);
  else                         console.log('[Haven]', event, entry);

  // Ship to server — fire-and-forget
  fetch('/api/v1/client-log', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ event, level, session: SESSION_ID, data: data ?? {} }),
  }).catch(() => { /* never let logging break the app */ });
}

// Convenience wrappers
export const cLog  = (event: string, data?: Record<string, unknown>) => clientLog(event, data, 'info');
export const cWarn = (event: string, data?: Record<string, unknown>) => clientLog(event, data, 'warn');
export const cErr  = (event: string, data?: Record<string, unknown>) => clientLog(event, data, 'error');
