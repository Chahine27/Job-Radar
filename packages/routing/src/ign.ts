import { RateLimiter, type FetchLike } from "@job-radar/source-connectors";
import type { Point, RoutingService, TravelEstimate } from "./types";

/**
 * Calcul d'itinéraire de la Géoplateforme (IGN) : en VOITURE, France entière (DROM compris), gratuit, sans clé ni compte.
 * Pas de transports en commun. Limite : 5 requêtes/s par adresse IP (on reste à ~3/s). 429 → attendre « Retry-After ».
 * Doc : https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/
 * Données : © IGN — Géoplateforme (Licence Ouverte Etalab).
 * Réponses réelles relevées le 01/10/2026 : « duration » en secondes (timeUnit=second) ; aucun chemin → 404
 * { error: { message: "No path found" } } ; un point loin de toute route est « collé » à la route la plus proche
 * (parfois à des dizaines de km) → on vérifie que le départ et l'arrivée renvoyés sont bien ceux demandés.
 */
export const IGN_DEFAULTS = {
  baseUrl: "https://data.geopf.fr/navigation/itineraire",
  minDelayMs: 350,
  /** Écart maximum entre le point demandé et le point « collé » à la route par l'IGN. */
  maxSnapKm: 2,
  /** Attente maximum acceptée après un 429 (Retry-After), en secondes. */
  maxRetryAfterS: 10,
};

/** Distance à vol d'oiseau en km (formule de haversine). */
export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** « lon,lat » (format de l'IGN) → point. */
function parseLonLat(s: unknown): Point | null {
  if (typeof s !== "string") return null;
  const [lng, lat] = s.split(",").map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lat: lat!, lng: lng! } : null;
}

export class IgnRoutingService implements RoutingService {
  readonly name = "ign-car";
  private readonly limiter: RateLimiter;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly opts: { baseUrl?: string; fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.fetch = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limiter = new RateLimiter(IGN_DEFAULTS.minDelayMs, undefined, this.sleep);
  }

  /** Aucune clé nécessaire : toujours disponible. */
  isConfigured() {
    return true;
  }

  async estimateTravelTime(origin: Point, destination: Point): Promise<TravelEstimate> {
    const q = new URLSearchParams({
      resource: "bdtopo-osrm",
      profile: "car",
      optimization: "fastest",
      start: `${origin.lng.toFixed(6)},${origin.lat.toFixed(6)}`,
      end: `${destination.lng.toFixed(6)},${destination.lat.toFixed(6)}`,
      distanceUnit: "kilometer",
      timeUnit: "second",
      crs: "EPSG:4326",
      getSteps: "false",
    });
    const url = `${this.opts.baseUrl ?? IGN_DEFAULTS.baseUrl}?${q}`;
    let res = await this.limiter.schedule(() => this.fetch(url, { headers: { Accept: "application/json" } }));
    if (res.status === 429) {
      // Trop d'appels : l'IGN bloque ~5 s. On attend une fois ce qu'il demande, puis on réessaie.
      const wait = Math.min(Number(res.headers.get("retry-after")) || 5, IGN_DEFAULTS.maxRetryAfterS);
      await this.sleep(wait * 1000);
      res = await this.limiter.schedule(() => this.fetch(url, { headers: { Accept: "application/json" } }));
    }
    const body = (await res.json().catch(() => ({}))) as { duration?: unknown; start?: unknown; end?: unknown; error?: { message?: string } };
    if (!res.ok) {
      if (res.status === 404 && /no path found/i.test(body.error?.message ?? "")) return { minutes: null, provider: this.name, reason: "no_solution" };
      throw new Error(`Calcul d'itinéraire IGN en erreur (HTTP ${res.status}${body.error?.message ? ` : ${body.error.message.trim()}` : ""})`);
    }
    // Point en mer, en pleine campagne sans route… : l'IGN part de la route la plus proche, parfois très loin.
    const start = parseLonLat(body.start);
    const end = parseLonLat(body.end);
    if (!start || !end) throw new Error("Réponse de l'IGN illisible (départ ou arrivée manquant)");
    if (distanceKm(start, origin) > IGN_DEFAULTS.maxSnapKm) return { minutes: null, provider: this.name, reason: "no_origin" };
    if (distanceKm(end, destination) > IGN_DEFAULTS.maxSnapKm) return { minutes: null, provider: this.name, reason: "no_destination" };
    if (typeof body.duration !== "number" || !Number.isFinite(body.duration) || body.duration < 0) {
      throw new Error("Réponse de l'IGN illisible (durée manquante)");
    }
    return { minutes: Math.round(body.duration / 60), provider: this.name };
  }
}
