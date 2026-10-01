import type { Point, RoutingService, TravelEstimate } from "./types";

/** Île-de-France, en gros (rectangle) : PRIM n'est essayé que si départ ET arrivée y sont. */
export const IDF_BOX = { minLat: 48.1, maxLat: 49.25, minLng: 1.44, maxLng: 3.56 };
export const inIdf = (p: Point) => p.lat >= IDF_BOX.minLat && p.lat <= IDF_BOX.maxLat && p.lng >= IDF_BOX.minLng && p.lng <= IDF_BOX.maxLng;

/** Mode de transport d'un trajet, d'après le calculateur qui l'a donné (affiché sur le site). */
export function travelModeOf(provider: string | null | undefined): "transit" | "car" | null {
  if (!provider) return null;
  if (provider.startsWith("prim")) return "transit";
  if (provider.startsWith("ign-car")) return "car";
  return null;
}

export type RouteStep = { service: RoutingService; covers?: (origin: Point, destination: Point) => boolean };

/**
 * Plusieurs calculateurs, essayés dans l'ordre : le premier qui trouve une durée gagne
 * (ex. PRIM en transports en commun en Île-de-France, puis l'IGN en voiture partout ailleurs).
 * « provider » dit lequel a répondu (affiché sur le site). Jamais de durée inventée.
 */
export class FallbackRoutingService implements RoutingService {
  constructor(private readonly steps: RouteStep[]) {}

  private active() {
    return this.steps.filter((s) => s.service.isConfigured());
  }

  /** Change quand un calculateur devient disponible (clé ajoutée) : les trajets sont alors recalculés. */
  get name() {
    return this.active()
      .map((s) => s.service.name)
      .join("+");
  }

  isConfigured() {
    return this.active().length > 0;
  }

  async estimateTravelTime(origin: Point, destination: Point): Promise<TravelEstimate> {
    let last: TravelEstimate | null = null;
    let error: unknown = null;
    for (const step of this.active()) {
      if (step.covers && !step.covers(origin, destination)) continue;
      try {
        const r = await step.service.estimateTravelTime(origin, destination);
        if (r.minutes != null) return r;
        last = r;
      } catch (err) {
        // Ce calculateur est en panne (clé refusée, quota…) : on essaie le suivant.
        error = err;
      }
    }
    if (last) return last;
    if (error) throw error;
    return { minutes: null, provider: this.name, reason: "no_provider" };
  }
}
