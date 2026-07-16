// FLIGHT-NUMBER LOOKUP (PLAN.MD §3.3 MANUAL ANCHORS). SAME SWAPPABLE-PROVIDER
// SHAPE AS places_provider: THE UI ONLY KNOWS THIS INTERFACE, SO A REAL
// PROVIDER (AERODATABOX / FLIGHTAWARE VIA THE BACKEND PROXY) DROPS IN LATER.
// LOOKUP IS SUGAR — MANUAL TIME ENTRY ALWAYS WORKS WITHOUT IT.

export interface FlightInfo {
  flight_number: string;
  airline: string;
  origin: string;
  destination: string;
  // MINUTES SINCE MIDNIGHT, LOCAL TO EACH AIRPORT.
  departure_time: number;
  arrival_time: number;
}

export interface FlightLookupProvider {
  lookup(flight_number: string): Promise<FlightInfo | null>;
}

// DEMO DATASET SO THE WEEK-2 FLOW IS EXERCISABLE OFFLINE. REPLACED BY A REAL
// PROVIDER BEHIND THE BACKEND PROXY — NEVER CALLED WITH RAW KEYS FROM CLIENT.
const DEMO_FLIGHTS: FlightInfo[] = [
  { flight_number: 'DL 1204', airline: 'Delta', origin: 'JFK', destination: 'BOS', departure_time: 605, arrival_time: 700 },
  { flight_number: 'DL 2210', airline: 'Delta', origin: 'BOS', destination: 'JFK', departure_time: 940, arrival_time: 1025 },
  { flight_number: 'AA 100', airline: 'American', origin: 'JFK', destination: 'LHR', departure_time: 1115, arrival_time: 1410 },
  { flight_number: 'UA 302', airline: 'United', origin: 'SFO', destination: 'BOS', departure_time: 480, arrival_time: 810 },
  { flight_number: 'B6 617', airline: 'JetBlue', origin: 'BOS', destination: 'MCO', departure_time: 555, arrival_time: 745 },
];

export function normalize_flight_number(raw: string): string {
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  const match = compact.match(/^([A-Z0-9]{2})(\d{1,4})$/);
  return match ? `${match[1]} ${match[2]}` : compact;
}

export const flight_lookup: FlightLookupProvider = {
  async lookup(flight_number) {
    const normalized = normalize_flight_number(flight_number);
    return DEMO_FLIGHTS.find((f) => f.flight_number === normalized) ?? null;
  },
};
