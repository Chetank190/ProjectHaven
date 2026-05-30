// Mirror of backend/config.py voice constants — keep in sync manually

export const VOICE_HOLD_MAX_MS      = 45_000;
export const VOICE_SILENCE_KILL_MS  = 10_000;
export const VOICE_SESSION_IDLE_MS  = 120_000;
export const VOICE_MIN_CHARS        = 10;

export const API_BASE = '/api/v1';

export const KIOSK_HUBS: Record<string, [number, number]> = {
  'Union Station':      [43.6452, -79.3806],
  'Yonge & Dundas':     [43.6561, -79.3802],
  'Scarborough Centre': [43.7731, -79.2570],
  'Regent Park':        [43.6584, -79.3606],
  'Etobicoke Civic':    [43.6435, -79.5605],
};

export const KIOSK_DEFAULT_HUB: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).env?.VITE_KIOSK_HUB || 'Union Station';
