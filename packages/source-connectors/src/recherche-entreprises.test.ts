import { describe, expect, it } from "vitest";
import { RechercheEntreprisesClient } from "./recherche-entreprises";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("API Recherche d'entreprises : adresse exacte par SIRET", () => {
  it("prend l'établissement qui a CE SIRET (pas forcément le siège)", async () => {
    const urls: string[] = [];
    const client = new RechercheEntreprisesClient({
      sleep: async () => {},
      fetch: async (u) => {
        urls.push(u);
        return json({
          results: [
            {
              siege: { siret: "41816609600069", adresse: "34 AVENUE DE L'OPERA 75002 PARIS" },
              matching_etablissements: [{ siret: "41816609600077", adresse: "12  RUE DE LA GARE 60100 CREIL" }],
            },
          ],
        });
      },
    });
    expect(await client.address("41816609600077")).toBe("12 RUE DE LA GARE 60100 CREIL");
    expect(await client.address("41816609600069")).toBe("34 AVENUE DE L'OPERA 75002 PARIS");
    expect(urls[0]).toBe("https://recherche-entreprises.api.gouv.fr/search?q=41816609600077&page=1&per_page=1");
  });

  it("inconnue ou non diffusible → null ; erreur HTTP → exception", async () => {
    const none = new RechercheEntreprisesClient({ sleep: async () => {}, fetch: async () => json({ results: [] }) });
    expect(await none.address("11111111100011")).toBeNull();
    const nd = new RechercheEntreprisesClient({ sleep: async () => {}, fetch: async () => json({ results: [{ siege: { siret: "1", adresse: "[ND]" } }] }) });
    expect(await nd.address("1")).toBeNull();
    const down = new RechercheEntreprisesClient({ sleep: async () => {}, fetch: async () => json({}, 429) });
    await expect(down.address("1")).rejects.toThrow(/429/);
  });
});
