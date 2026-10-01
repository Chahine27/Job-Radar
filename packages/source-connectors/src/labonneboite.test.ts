import { describe, expect, it } from "vitest";
import { LaBonneBoiteClient, lbbCompanyUrl } from "./labonneboite";
import { SourceUnavailableError } from "./types";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const company = (i: number) => ({
  siret: `9347015660${String(i).padStart(4, "0")}`,
  company_name: `ENTREPRISE ${i}`,
  office_name: "",
  email: "yes",
  headcount_min: "10",
  headcount_max: 19,
  naf: "6202A",
  naf_label: "Conseil en systèmes et logiciels informatiques",
  location: { lat: 45.61, lon: 4.89 },
  city: "Vénissieux",
  citycode: "69259",
  postcode: "69200",
  department_number: "69",
  hiring_potential: 42.5,
  is_high_potential: true,
});

describe("La Bonne Boîte", () => {
  it("non configurée sans identifiants", async () => {
    const c = new LaBonneBoiteClient({ clientId: "", clientSecret: undefined, sleep: async () => {} });
    expect(c.isConfigured()).toBe(false);
    await expect(c.search({ romes: ["M1805"] })).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("test des identifiants : demande un jeton neuf, sans recherche", async () => {
    const urls: string[] = [];
    let status = 200;
    const c = new LaBonneBoiteClient({
      clientId: "id",
      clientSecret: "secret",
      sleep: async () => {},
      fetch: async (url) => (urls.push(url), status === 200 ? json({ access_token: "tok", expires_in: 1499 }) : json({ error: "invalid_scope" }, status)),
    });
    await c.healthCheck();
    await c.healthCheck();
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes("access_token"))).toBe(true);
    status = 400;
    await expect(c.healthCheck()).rejects.toThrow("HTTP 400");
  });

  it("droits « api_labonneboitev2 search », adresse /recherche, autour du domicile, pagination", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const c = new LaBonneBoiteClient({
      clientId: "id",
      clientSecret: "secret",
      sleep: async () => {},
      fetch: async (url, init) => {
        calls.push({ url, body: init?.body ? String(init.body) : undefined });
        if (url.includes("access_token")) return json({ access_token: "tok", expires_in: 1499 });
        const page = Number(new URL(url).searchParams.get("page"));
        return json({ hits: 60, items: Array.from({ length: page === 1 ? 50 : 10 }, (_, i) => company(page * 100 + i)) });
      },
    });
    const res = await c.search({ romes: ["M1805", "M1810"], point: { lat: 45.6138, lng: 4.8892, distanceKm: 30 }, maxResults: 100 });
    expect(res).toHaveLength(60);
    expect(new URLSearchParams(calls[0]!.body).get("scope")).toBe("api_labonneboitev2 search");
    const u = new URL(calls[1]!.url);
    expect(u.pathname).toBe("/partenaire/labonneboite/v2/recherche");
    expect(u.searchParams.getAll("rome")).toEqual(["M1805", "M1810"]);
    expect(u.searchParams.get("distance")).toBe("30");
    expect(u.searchParams.get("sort_by")).toBe("hiring_potential");
    expect(res[0]!.headcount_min).toBe(10);
  });

  it("par départements si pas de point de départ", async () => {
    const urls: string[] = [];
    const c = new LaBonneBoiteClient({
      clientId: "id",
      clientSecret: "s",
      sleep: async () => {},
      fetch: async (url) => {
        urls.push(url);
        return url.includes("access_token") ? json({ access_token: "t", expires_in: 1499 }) : json({ hits: 0, items: [] });
      },
    });
    await c.search({ romes: ["M1805"], departments: ["69", "75"] });
    expect(new URL(urls[1]!).searchParams.getAll("department_number")).toEqual(["69", "75"]);
  });

  it("lien vers la fiche publique", () => {
    expect(lbbCompanyUrl("93470156600010")).toBe("https://labonneboite.francetravail.fr/entreprise/93470156600010");
  });
});
