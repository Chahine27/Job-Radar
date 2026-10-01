import { describe, expect, it } from "vitest";
import { FallbackRoutingService, inIdf, travelModeOf } from "./fallback";
import { IGN_DEFAULTS, IgnRoutingService, distanceKm } from "./ign";
import type { Point, RoutingService, TravelEstimate } from "./types";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// Forme des réponses relevée sur la vraie API le 01/10/2026 (Nantes centre → Saint-Herblain).
const NANTES = { lat: 47.218371, lng: -1.553621 };
const HERBLAIN = { lat: 47.212, lng: -1.647 };
const OK_BODY = {
  resource: "bdtopo-osrm",
  start: "-1.553467,47.218324",
  end: "-1.646752,47.21186",
  profile: "car",
  distance: 8.8644,
  duration: 2152.8,
  timeUnit: "second",
};

describe("IGN (voiture, France entière, sans clé)", () => {
  it("appelle /navigation/itineraire en lon,lat, durée en secondes → minutes", async () => {
    const urls: string[] = [];
    const svc = new IgnRoutingService({ fetch: async (url) => (urls.push(url), json(OK_BODY)), sleep: async () => {} });
    expect(svc.isConfigured()).toBe(true);
    expect(await svc.estimateTravelTime(NANTES, HERBLAIN)).toEqual({ minutes: 36, provider: "ign-car" });
    const u = new URL(urls[0]!);
    expect(`${u.origin}${u.pathname}`).toBe(IGN_DEFAULTS.baseUrl);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      resource: "bdtopo-osrm",
      profile: "car",
      optimization: "fastest",
      start: "-1.553621,47.218371",
      end: "-1.647000,47.212000",
      timeUnit: "second",
      crs: "EPSG:4326",
    });
  });

  it("« No path found » → pas d'itinéraire (null, jamais inventé)", async () => {
    const svc = new IgnRoutingService({ fetch: async () => json({ error: { message: " No path found " } }, 404), sleep: async () => {} });
    expect(await svc.estimateTravelTime(NANTES, { lat: 40.7, lng: -74 })).toEqual({ minutes: null, provider: "ign-car", reason: "no_solution" });
  });

  it("un autre 404 ou une erreur serveur est une vraie erreur", async () => {
    const svc = new IgnRoutingService({ fetch: async () => json({ error: { message: "Not Found" } }, 404), sleep: async () => {} });
    await expect(svc.estimateTravelTime(NANTES, HERBLAIN)).rejects.toThrow("HTTP 404");
    const down = new IgnRoutingService({ fetch: async () => json({}, 503), sleep: async () => {} });
    await expect(down.estimateTravelTime(NANTES, HERBLAIN)).rejects.toThrow("HTTP 503");
  });

  it("point en mer : l'IGN « colle » l'arrivée à une route lointaine → pas d'itinéraire", async () => {
    // Vrai cas relevé : arrivée demandée au large, renvoyée à la pointe de Penmarc'h.
    const svc = new IgnRoutingService({
      fetch: async () => json({ ...OK_BODY, end: "-4.374684,47.797508", duration: 9000 }),
      sleep: async () => {},
    });
    expect(await svc.estimateTravelTime(NANTES, { lat: 46, lng: -5.5 })).toEqual({ minutes: null, provider: "ign-car", reason: "no_destination" });
  });

  it("429 : attend le délai demandé (Retry-After) puis réessaie une fois", async () => {
    const waits: number[] = [];
    let n = 0;
    const svc = new IgnRoutingService({
      fetch: async () => (n++ === 0 ? json({}, 429, { "retry-after": "5" }) : json(OK_BODY)),
      sleep: async (ms) => void waits.push(ms),
    });
    expect((await svc.estimateTravelTime(NANTES, HERBLAIN)).minutes).toBe(36);
    expect(waits).toContain(5000);
    expect(n).toBe(2);
  });

  it("réponse sans durée → erreur (pas de valeur inventée)", async () => {
    const svc = new IgnRoutingService({ fetch: async () => json({ ...OK_BODY, duration: undefined }), sleep: async () => {} });
    await expect(svc.estimateTravelTime(NANTES, HERBLAIN)).rejects.toThrow("durée manquante");
  });

  it("distance à vol d'oiseau", () => {
    expect(distanceKm(NANTES, HERBLAIN)).toBeGreaterThan(6);
    expect(distanceKm(NANTES, HERBLAIN)).toBeLessThan(8);
  });
});

function fake(name: string, result: TravelEstimate | Error, configured = true): RoutingService & { calls: number } {
  const svc = {
    name,
    calls: 0,
    isConfigured: () => configured,
    estimateTravelTime: async (_o: Point, _d: Point) => {
      svc.calls++;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return svc;
}

describe("trajets : transports en Île-de-France, voiture ailleurs", () => {
  const PARIS = { lat: 48.8809, lng: 2.3553 };
  const DEFENSE = { lat: 48.8918, lng: 2.2378 };
  const LYON = { lat: 45.7606, lng: 4.8592 };

  it("PRIM seulement si départ et arrivée sont en Île-de-France", async () => {
    const prim = fake("prim-idfm", { minutes: 25, provider: "prim-idfm" });
    const car = fake("ign-car", { minutes: 40, provider: "ign-car" });
    const svc = new FallbackRoutingService([{ service: prim, covers: (o, d) => inIdf(o) && inIdf(d) }, { service: car }]);
    expect(await svc.estimateTravelTime(PARIS, DEFENSE)).toEqual({ minutes: 25, provider: "prim-idfm" });
    expect(await svc.estimateTravelTime(PARIS, LYON)).toEqual({ minutes: 40, provider: "ign-car" });
    expect(prim.calls).toBe(1); // aucun appel PRIM gaspillé pour Lyon
    expect(svc.name).toBe("prim-idfm+ign-car");
  });

  it("PRIM sans itinéraire ou en panne → voiture ; sans clé PRIM → voiture directement", async () => {
    const car = fake("ign-car", { minutes: 40, provider: "ign-car" });
    const noRoute = new FallbackRoutingService([{ service: fake("prim-idfm", { minutes: null, provider: "prim-idfm", reason: "no_solution" }) }, { service: car }]);
    expect((await noRoute.estimateTravelTime(PARIS, DEFENSE)).provider).toBe("ign-car");
    const broken = new FallbackRoutingService([{ service: fake("prim-idfm", new Error("HTTP 401")) }, { service: car }]);
    expect((await broken.estimateTravelTime(PARIS, DEFENSE)).provider).toBe("ign-car");
    const noKey = new FallbackRoutingService([{ service: fake("prim-idfm", new Error("x"), false) }, { service: car }]);
    expect(noKey.name).toBe("ign-car"); // la clé ajoutée plus tard change le nom → trajets recalculés
  });

  it("personne ne trouve → null ; tout le monde en panne → erreur", async () => {
    const none = new FallbackRoutingService([{ service: fake("ign-car", { minutes: null, provider: "ign-car", reason: "no_solution" }) }]);
    expect(await none.estimateTravelTime(PARIS, LYON)).toEqual({ minutes: null, provider: "ign-car", reason: "no_solution" });
    const down = new FallbackRoutingService([{ service: fake("ign-car", new Error("HTTP 503")) }]);
    await expect(down.estimateTravelTime(PARIS, LYON)).rejects.toThrow("HTTP 503");
  });

  it("mode affiché d'après le calculateur", () => {
    expect(travelModeOf("prim-idfm")).toBe("transit");
    expect(travelModeOf("ign-car")).toBe("car");
    expect(travelModeOf("demo")).toBeNull();
    expect(travelModeOf(null)).toBeNull();
  });
});
