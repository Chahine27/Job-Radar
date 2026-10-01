import { describe, expect, it } from "vitest";
import { suggestRomes } from "./rome-suggest";
import { createTestApp, login } from "./test-helpers";

const romeo = (jobs: Record<string, Array<{ code: string; score: number }>>) => ({
  isConfigured: () => true,
  predict: async (titles: string[]) => titles.map((title) => ({ title, jobs: (jobs[title] ?? []).map((j) => ({ ...j, label: j.code })) })),
});

describe("propositions de codes métier", () => {
  it("ROMEO d'abord : un code par métier recherché, codes inconnus ou peu sûrs écartés", async () => {
    const res = await suggestRomes(["Aide-soignante", "Agent de service hospitalier"], {
      romeo: romeo({
        "Aide-soignante": [{ code: "J1501", score: 0.9 }, { code: "Z9999", score: 0.8 }],
        "Agent de service hospitalier": [{ code: "J1301", score: 0.7 }, { code: "K2204", score: 0.1 }],
      }),
      aiPick: async () => {
        throw new Error("l'IA ne doit pas être utilisée");
      },
    });
    expect(res.source).toBe("france-travail");
    expect(res.items.map((j) => j.code)).toEqual(["J1501", "J1301"]);
    expect(res.items[0]!.label).toBe("Aide-soignant / Aide-soignante"); // libellé officiel, pas celui de l'API
  });

  it("ROMEO en panne → l'IA locale choisit parmi la liste ; un code hors liste est écarté", async () => {
    let seen: string[] = [];
    const res = await suggestRomes(["Aide-soignante"], {
      romeo: { isConfigured: () => true, predict: async () => Promise.reject(new Error("HTTP 500")) },
      aiPick: async (_s, candidates) => ((seen = candidates.map((c) => c.code)), ["Z9999", "J1501"]),
    });
    expect(seen).toContain("J1501");
    expect(res).toEqual({ source: "ia", items: [{ code: "J1501", label: "Aide-soignant / Aide-soignante" }] });
  });

  it("sans clé ni IA : seulement les métiers presque identiques de la liste officielle", async () => {
    const res = await suggestRomes(["Comptable", "Boulanger", "zzqxw"], {
      romeo: { isConfigured: () => false, predict: async () => [] },
      aiPick: async () => Promise.reject(new Error("Ollama ne répond pas")),
    });
    expect(res.source).toBe("liste");
    expect(res.items.map((j) => j.code).slice(0, 2)).toEqual(["M1203", "D1102"]);
    expect(res.items.length).toBeLessThanOrEqual(5);
  });

  it("rien de reconnu → aucune proposition (jamais de code inventé)", async () => {
    expect(await suggestRomes(["zzqxw"], {})).toEqual({ items: [], source: "aucune" });
    expect(await suggestRomes([" "], {})).toEqual({ items: [], source: "aucune" });
  });
});

describe("routes des codes métier et fin du premier lancement", () => {
  it("connexion obligatoire, proposition et recherche dans la liste", async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: "GET", url: "/api/rome/search?q=boulanger" })).statusCode).toBe(401);
    const cookies = await login(app);
    const search = await app.inject({ method: "GET", url: "/api/rome/search?q=boulanger", cookies });
    expect(search.json().items[0]).toEqual({ code: "D1102", label: "Boulanger / Boulangère" });
    expect((await app.inject({ method: "GET", url: "/api/rome/search?q=a", cookies })).json().items).toEqual([]);
    const sug = await app.inject({ method: "POST", url: "/api/rome/suggest", cookies, payload: { searches: ["Aide-soignante"] } });
    expect(sug.json()).toEqual({ source: "liste", items: [{ code: "J1501", label: "Aide-soignant / Aide-soignante" }] });
    expect((await app.inject({ method: "POST", url: "/api/rome/suggest", cookies, payload: { searches: [] } })).statusCode).toBe(400);
  });

  async function finish(romes: unknown) {
    const t = await createTestApp({ noUser: true });
    const acc = await t.app.inject({ method: "POST", url: "/api/setup/account", payload: { email: "camille@example.com", password: "un-mot-de-passe-long" } });
    const cookies = { jr_session: acc.cookies.find((c) => c.name === "jr_session")!.value };
    return t.app.inject({
      method: "POST",
      url: "/api/setup/finish",
      cookies,
      payload: {
        fullName: "Camille Martin", email: null, phone: null, city: "Nantes", postalCode: "44000", department: "44",
        searches: ["Aide-soignante"], skills: ["Soins d'hygiène"], yearsOfExperience: 4, contracts: ["CDI"], romes,
      },
    });
  }

  it("enregistre les codes métier et met la zone des candidatures spontanées sur la ville du CV", async () => {
    const res = await finish(["j1501", "J1501", "J1301"]);
    expect(res.statusCode).toBe(200);
    const s = res.json().profile.spontaneous;
    expect(s.romes).toEqual(["J1501", "J1301"]);
    expect(s.place).toEqual({ label: "Place de la Gare 69100 Villeurbanne", lat: 45.7714, lng: 5.2467 });
  });

  it("refuse un code inconnu ou plus de 5 codes", async () => {
    const bad = await finish(["J1501", "Z9999"]);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toContain("Code métier inconnu");
    expect((await finish(["J1501", "J1301", "M1203", "D1102", "N4101", "M1213"])).statusCode).toBe(400);
  });
});
