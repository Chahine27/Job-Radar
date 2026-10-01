import { describe, expect, it } from "vitest";
import { ROMEO, RomeoClient } from "./romeo";
import { SourceUnavailableError } from "./types";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("ROMEO (codes métier France Travail)", () => {
  it("non configuré sans identifiants", async () => {
    const c = new RomeoClient({ clientId: undefined, clientSecret: "", sleep: async () => {} });
    expect(c.isConfigured()).toBe(false);
    await expect(c.predict(["Boulanger"])).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("droits « api_romeov2 », POST /predictionMetiers, résultats triés par confiance", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const c = new RomeoClient({
      clientId: "id",
      clientSecret: "secret",
      sleep: async () => {},
      fetch: async (url, init) => {
        calls.push({ url, body: String(init?.body) });
        if (url.includes("access_token")) return json({ access_token: "tok", expires_in: 1499 });
        return json([
          {
            identifiant: "1",
            intitule: "Aide-soignante",
            metiersRome: [
              { codeRome: "J1501", libelleRome: "Aide-soignant / Aide-soignante", libelleAppellation: "Aide-soignant", scorePrediction: 0.91 },
            ],
            uuidInference: "u2",
          },
          {
            identifiant: "0",
            intitule: "Boulanger",
            metiersRome: [
              { codeRome: "D1104", libelleRome: "Pâtisserie", scorePrediction: 0.2 },
              { codeRome: "D1102", libelleRome: "Boulangerie", scorePrediction: 0.8 },
            ],
            uuidInference: "u1",
          },
        ]);
      },
    });
    const res = await c.predict([" Boulanger ", "Aide-soignante", ""]);
    expect(calls[0]!.body).toContain("scope=api_romeov2");
    expect(calls[1]!.url).toBe(`${ROMEO.baseUrl}/predictionMetiers`);
    expect(JSON.parse(calls[1]!.body)).toEqual({
      appellations: [
        { intitule: "Boulanger", identifiant: "0" },
        { intitule: "Aide-soignante", identifiant: "1" },
      ],
      options: { nomAppelant: "job-radar", nbResultats: 3 },
    });
    expect(res).toEqual([
      { title: "Boulanger", jobs: [{ code: "D1102", label: "Boulangerie", score: 0.8 }, { code: "D1104", label: "Pâtisserie", score: 0.2 }] },
      { title: "Aide-soignante", jobs: [{ code: "J1501", label: "Aide-soignant / Aide-soignante", score: 0.91 }] },
    ]);
  });

  it("20 intitulés au plus par appel, rien à demander si la liste est vide", async () => {
    let body = "";
    const c = new RomeoClient({
      clientId: "id",
      clientSecret: "secret",
      sleep: async () => {},
      fetch: async (url, init) => (url.includes("access_token") ? json({ access_token: "t", expires_in: 1499 }) : ((body = String(init?.body)), json([]))),
    });
    expect(await c.predict([])).toEqual([]);
    await c.predict(Array.from({ length: 25 }, (_, i) => `Métier ${i}`));
    expect(JSON.parse(body).appellations).toHaveLength(ROMEO.maxTitles);
  });

  it("droit refusé → erreur claire (test des Réglages)", async () => {
    const c = new RomeoClient({ clientId: "id", clientSecret: "secret", sleep: async () => {}, fetch: async () => json({ error: "invalid_scope" }, 400) });
    await expect(c.healthCheck()).rejects.toThrow("ROMEO refusée (HTTP 400)");
  });
});
