// All API request/response shapes. Import from here — never inline ad-hoc types.

export interface NeedsPayload {
  needs_shelter:       boolean;
  needs_rehab:         boolean;
  needs_food:          boolean;
  needs_supplies:      boolean;
  needs_hygiene:       boolean;
  needs_youth_service: boolean;
  needs_library:       boolean;
  needs_respite:       boolean;
  needs_medical:       boolean;
  sector:              'youth' | 'adult' | 'family' | 'any';
  has_id:              boolean | null;
  sobriety_status:     'sober' | 'using' | null;
  group_size:          'alone' | 'with_family' | null;
  gender:              'male' | 'female' | 'non_binary' | null;
}

export interface ItineraryResult {
  pillar:             string;
  name:               string;
  address:            string;
  lat:                number;
  lon:                number;
  distance_km:        number;
  distance_walk_min:  number;
  occupancy_ratio:    number;
  transit_accessible: boolean;
  composite_score:    number;
  open_now:           boolean;
  phone:              string;
  hours:              string;
  requires_id:        boolean;
  harm_reduction:     boolean;
  bypass_pathway:     string;
  intake_preparation: string;
  accessible:         boolean;
}

export type Itinerary = Record<string, ItineraryResult[]>;

export interface CaseworkerRouteRequest {
  text:           string;
  origin_lat:     number;
  origin_lon:     number;
  client_name?:   string;
  caseworker_id?: string;
}

export interface CaseworkerRouteResponse {
  crisis?:          boolean;
  crisis_category?: string;
  crisis_hotline?:  string;
  hotline_name?:    string;
  escalation_text?: string;
  payload:               NeedsPayload;
  compile_method:        'nim' | 'regex' | 'crisis_gate';
  nim_latency_ms:        number;
  gpu_solve_ms:          number;
  cpu_solve_ms:          number | null;
  speedup:               number | null;
  itinerary:             Itinerary;
  ticket_text:           string;
  eligibility_questions: string[];
  case_id?:              string;
  returning_hint?:       ReturningClientHint;
}

export interface ReturningClientHint {
  case_id:     string;
  last_seen:   string;
  placed_at:   string | null;
  outcome:     string;
  similarity:  number;
  client_name: string;
}

export interface CapacityResponse {
  total_beds:     number;
  available_beds: number;
  occupied_beds:  number;
  occupancy_pct:  number;
}

export interface AuthUser     { email: string; name: string; role: string; }
export interface AuthResponse { token: string; user: AuthUser; }

export type CaseOutcome = 'pending' | 'placed' | 'declined' | 'returned' | 'referred_elsewhere';

export interface CaseRecord {
  id:            string;
  caseworker_id: string;
  client_name:   string;
  created_at:    string;
  transcript:    string;
  needs:         NeedsPayload | null;
  itinerary:     Itinerary | null;
  ticket_text:   string | null;
  outcome:       CaseOutcome;
  outcome_notes: string | null;
  updated_at:    string;
}

export interface CaseworkerHistoryResponse {
  cases: CaseRecord[];
  total: number;
}

export interface OutcomeUpdateRequest {
  outcome: CaseOutcome;
  notes?:  string;
}

export interface KioskSessionRequest {
  transcript:  string;
  origin_lat:  number;
  origin_lon:  number;
}

export interface KioskSessionResponse {
  crisis?:          boolean;
  crisis_category?: string;
  crisis_hotline?:  string;
  hotline_name?:    string;
  escalation_text?: string;
  session_id:             string | null;
  payload_draft:          NeedsPayload | null;
  eligibility_questions:  string[];
  next_step:              'collect_eligibility' | 'route' | 'crisis';
}

export interface KioskRouteRequest {
  session_id:           string;
  eligibility_answers:  Partial<Pick<NeedsPayload, 'has_id' | 'sobriety_status' | 'group_size'>>;
}

export interface KioskRouteResponse {
  itinerary:          Itinerary;
  tts_script:         string;
  gpu_solve_ms:       number;
  medical_facilities?: Hospital[];
}

export interface NearbyService {
  pillar:             string;
  name:               string;
  address:            string;
  lat:                number;
  lon:                number;
  distance_km:        number;
  distance_walk_min:  number;
  hours:              string;
  phone:              string;
  requires_id:        boolean;
  harm_reduction:     boolean;
  transit_accessible: boolean;
  open_now:           boolean | null;
  bypass_pathway:     string;
  intake_preparation: string;
}

export interface NearbyResponse {
  services:  NearbyService[];
  total:     number;
  radius_km: number;
}

export interface Hospital {
  name:               string;
  address:            string;
  lat:                number;
  lon:                number;
  type:               'public' | 'private';
  emergency:          boolean;
  phone:              string;
  hours:              string;
  note:               string;
  distance_km:        number;
  distance_walk_min:  number;
  distance_drive_min: number;
}

export interface HospitalsResponse {
  hospitals: Hospital[];
  total:     number;
}

export interface KioskReserveRequest {
  session_id:       string;
  facility_name:    string;
  facility_address: string;
  pillar:           string;
}

export interface KioskReserveResponse {
  code:             string;
  facility_name:    string;
  facility_address: string;
  pillar:           string;
  expires_at:       string;
}

export interface BriefingRequest {
  current_time_iso: string;
}

export interface BriefingResponse {
  briefing_text:     string;
  shelter_snapshot?: { total_beds: number; available_beds: number };
}

export interface HandoffRequest {
  facility_name:  string;
  facility_phone: string;
  payload:        NeedsPayload;
}

export interface HandoffResponse {
  script:   string;
  facility: string;
  phone:    string;
}

export interface BenchmarkResponse {
  last_gpu_ms: number | null;
  last_cpu_ms: number | null;
  speedup:     number | null;
}

export interface HealthResponse {
  status:        string;
  rapids_mode:   string;
  weather_alert: string | null;
  datasets:      Record<string, number>;
  total_records: number;
}

export interface SystemResponse {
  gpu_info: {
    vram_used_gb:        number;
    vram_total_gb:       number;
    vram_free_gb:        number;
    gpu_utilization_pct: number;
    temperature_c:       number;
  } | null;
  weather_alert: string | null;
}

export interface TelemetrySummary {
  total_routes:          number;
  gateway_breakdown:     Record<string, number>;
  most_requested_pillar: [string, number] | null;
  pillar_request_counts: Record<string, number>;
  avg_gpu_solve_ms:      number | null;
}

export interface ApiError {
  detail: string | { loc: string[]; msg: string; type: string }[];
}
