import { describe, expect, it } from "vitest";
import { geocode } from "./geocode";
import { PrimRoutingService, nextWeekdayMorning } from "./prim";
import { originKeyOf, routeKeyOf } from "./travel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("géocodage", () => {
  it("renvoie les coordonnées et ignore les résultats peu sûrs", async () => {
    const urls: string[] = [];
    const res = await geocode("Gare de Villeurbanne", {
      fetch: async (u) => {
        urls.push(u);
        return json({
          features: [
            { geometry: { coordinates: [5.2467, 45.7714] }, properties: { label: "Place de la Gare 69100 Villeurbanne", score: 0.82, type: "street" } },
            { geometry: { coordinates: [0, 0] }, properties: { label: "???", score: 0.2, type: "street" } },
          ],
        });
      },
      limit: 2,
    });
    expect(res).toEqual([{ lat: 45.7714, lng: 5.2467, label: "Place de la Gare 69100 Villeurbanne", precision: "address" }]);
    expect(new URL(urls[0]!).hostname).toBe("data.geopf.fr");
  });

  it("rien dans les adresses → cherche dans les lieux nommés (gares)", async () => {
    const indexes: string[] = [];
    const res = await geocode("gare de Vénissieux", {
      fetch: async (u) => {
        const idx = new URL(u).searchParams.get("index")!;
        indexes.push(idx);
        if (idx === "address") return json({ features: [] });
        return json({
          features: [{ geometry: { type: "Point", coordinates: [4.8886, 45.6135] }, properties: { name: ["Gare de Vénissieux"], city: ["Vénissieux"], postcode: ["69200"], score: 0.7 } }],
        });
      },
    });
    expect(indexes.sort()).toEqual(["address", "poi"]);
    expect(res[0]).toMatchObject({ lat: 45.6135, lng: 4.8886, label: "Gare de Vénissieux 69200 Vénissieux" });
  });

  it("garde le meilleur score entre adresses et lieux nommés", async () => {
    const res = await geocode("gare de Vénissieux", {
      fetch: async (u) =>
        new URL(u).searchParams.get("index") === "address"
          ? json({ features: [{ geometry: { coordinates: [5.13, 48.49] }, properties: { label: "Rue de la Gare 52300 Curel", score: 0.55 } }] })
          : json({ features: [{ geometry: { coordinates: [4.8886, 45.6135] }, properties: { name: "Gare de Vénissieux", city: "Vénissieux", score: 0.9 } }] }),
    });
    expect(res[0]!.label).toBe("Gare de Vénissieux Vénissieux");
  });

  it("requête trop courte → rien", async () => {
    expect(await geocode("a", { fetch: async () => json({}) })).toEqual([]);
  });
});

describe("PRIM", () => {
  const origin = { lat: 45.7714, lng: 5.2467 };
  const dest = { lat: 48.8766, lng: 2.3592 };

  it("prochain jour ouvré à 8 h", () => {
    expect(nextWeekdayMorning(new Date(2026, 8, 25, 18, 0))).toBe("20260928T080000"); // vendredi → lundi
    expect(nextWeekdayMorning(new Date(2026, 8, 28, 9, 0))).toBe("20260929T080000");
  });

  it("garde le trajet le plus court, en minutes, avec la clé dans l'en-tête apiKey", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const svc = new PrimRoutingService({
      apiKey: "cle",
      now: () => new Date(2026, 8, 28, 9, 0),
      sleep: async () => {},
      fetch: async (url, init) => {
        calls.push({ url, headers: init?.headers as Record<string, string> });
        return json({ journeys: [{ duration: 4200 }, { duration: 3540 }] });
      },
    });
    expect(await svc.estimateTravelTime(origin, dest)).toEqual({ minutes: 59, provider: "prim-idfm" });
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/marketplace/v2/navitia/journeys");
    expect(u.searchParams.get("from")).toBe("5.246700;45.771400");
    expect(calls[0]!.headers.apiKey).toBe("cle");
  });

  it("aucun itinéraire → null (jamais inventé)", async () => {
    const svc = new PrimRoutingService({ apiKey: "cle", sleep: async () => {}, fetch: async () => json({ error: { id: "no_origin" } }, 404) });
    expect(await svc.estimateTravelTime(origin, dest)).toEqual({ minutes: null, provider: "prim-idfm", reason: "no_origin" });
    const empty = new PrimRoutingService({ apiKey: "cle", sleep: async () => {}, fetch: async () => json({ journeys: [] }) });
    expect((await empty.estimateTravelTime(origin, dest)).minutes).toBeNull();
  });

  it("un 404 sans « pas d'itinéraire » est une vraie erreur (mauvaise adresse d'API)", async () => {
    const svc = new PrimRoutingService({ apiKey: "cle", sleep: async () => {}, fetch: async () => json({ message: "Not Found" }, 404) });
    await expect(svc.estimateTravelTime(origin, dest)).rejects.toThrow("HTTP 404");
  });

  it("clé refusée → erreur claire", async () => {
    const svc = new PrimRoutingService({ apiKey: "mauvaise", sleep: async () => {}, fetch: async () => json({}, 401) });
    await expect(svc.estimateTravelTime(origin, dest)).rejects.toThrow("HTTP 401");
    expect(new PrimRoutingService({ apiKey: "" }).isConfigured()).toBe(false);
  });

  it("clés de cache : domicile précis, destination arrondie à ~1 km", () => {
    expect(originKeyOf(origin)).toBe("45.771,5.247");
    expect(routeKeyOf("prim-idfm", origin, dest)).toBe("prim-idfm|45.771,5.247|48.88,2.36");
    expect(routeKeyOf("prim-idfm", origin, { lat: 48.8791, lng: 2.3571 })).toBe(routeKeyOf("prim-idfm", origin, dest));
  });
});
