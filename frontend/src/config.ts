// Mirror of backend/config.py voice constants — keep in sync manually

export const VOICE_HOLD_MAX_MS      = 45_000;
export const VOICE_SILENCE_KILL_MS  = 2_500;  // 2.5s natural pause before stopping
export const VOICE_SESSION_IDLE_MS  = 120_000;
export const VOICE_MIN_CHARS              = 10;
export const VOICE_ELIGIBILITY_WAIT_SEC   = 30;

export const API_BASE = '/api/v1';

// Downtown East — highest shelter density in Toronto (8,200+ beds nearby)
// Downtown Core — major transit/foot traffic hubs
// Downtown West + Midtown + Suburbs
// Coordinates sourced from shelter data clustering (data/shelters.csv)
export const KIOSK_HUBS: Record<string, [number, number]> = {
  'Moss Park / Sherbourne':   [43.6530, -79.3680],
  'Seaton House / George St': [43.6545, -79.3706],
  'Regent Park':              [43.6584, -79.3606],
  'Union Station':            [43.6452, -79.3806],
  'Yonge & Dundas':           [43.6561, -79.3802],
  'Spadina & Dundas':         [43.6538, -79.4004],
  'Parkdale':                 [43.6478, -79.4490],
  'Bloor & Christie':         [43.6620, -79.4200],
  'Danforth & Pape':          [43.6782, -79.3541],
  'Scarborough Centre':       [43.7731, -79.2570],
  'Etobicoke Civic':          [43.6435, -79.5605],
  'North York Centre':        [43.7680, -79.4130],
};

// Empty string = always show hub selector on kiosk start.
// Set VITE_KIOSK_HUB=<name> in .env to pre-configure a fixed location.
export const KIOSK_DEFAULT_HUB: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).env?.VITE_KIOSK_HUB || '';
