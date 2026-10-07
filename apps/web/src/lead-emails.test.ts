import { describe, expect, it } from "vitest";
import { buildEmailPrompt, parseEmailJson } from "./lead-emails";
import type { Lead } from "./types";

const lead = (siret: string, name: string): Lead => ({
  id: siret, siret, name, officeName: null, nafLabel: "Programmation informatique", headcountMin: 10, headcountMax: 19,
  city: "Vénissieux", postcode: "69200", department: "69", hiringPotential: 60, isHighPotential: true, hasEmail: true,
  contactEmail: null, address: siret.startsWith("1") ? "12 RUE DE LA GARE 69200 VENISSIEUX" : null, addressCheckedAt: null, status: "TO_CONTACT", notes: null, contactedAt: null, distanceKm: null, firstSeenAt: "2026-10-01",
});

describe("emails des entreprises via une IA avec recherche web", () => {
  it("le prompt contient chaque entreprise avec son SIRET, et interdit les adresses devinées", () => {
    const p = buildEmailPrompt([lead("11111111100011", "ALPHA LOGICIELS"), lead("22222222200022", "BETA SERVICES")]);
    expect(p).toContain('"siret": "11111111100011"');
    expect(p).toContain('"nom": "BETA SERVICES"');
    expect(p).toContain('"ville": "69200 Vénissieux"');
    expect(p).toContain('"adresse": "12 RUE DE LA GARE 69200 VENISSIEUX"');
    expect(p).toMatch(/N'INVENTE RIEN/);
    expect(p).toContain("candidature spontanée.");
  });

  it("le prompt cite le métier visé", () => {
    const p = buildEmailPrompt([lead("11111111100011", "ALPHA LOGICIELS")], "Assistant comptable");
    expect(p).toContain("candidature spontanée (Assistant comptable).");
  });

  it("le prompt demande un seul bloc de code, liens en texte brut", () => {
    const p = buildEmailPrompt([lead("11111111100011", "ALPHA LOGICIELS")]);
    expect(p).toContain("UN SEUL bloc de code");
    expect(p).toContain("TEXTE BRUT");
  });

  it("lit la réponse même entourée de texte ou de ```json, et ignore les lignes sans SIRET", () => {
    const answer = 'Voici :\n```json\n[{"siret":"111 111 111 00011","email":"rh@alpha.fr","source":"https://alpha.fr/contact"},{"siret":"22222222200022","email":null,"source":null},{"nom":"sans siret"}]\n```\nBonne chance !';
    expect(parseEmailJson(answer)).toEqual([
      { siret: "11111111100011", email: "rh@alpha.fr", source: "https://alpha.fr/contact", site: null, contactUrl: null },
      { siret: "22222222200022", email: null, source: null, site: null, contactUrl: null },
    ]);
    expect(parseEmailJson('[{"siret":"22222222200022","email":null,"site":"https://beta.fr","contact_url":"https://beta.fr/contact"}]')[0]).toMatchObject({
      site: "https://beta.fr",
      contactUrl: "https://beta.fr/contact",
    });
    expect(() => parseEmailJson("pas de json")).toThrow(/Aucun tableau/);
    expect(() => parseEmailJson("[{siret: 1,}]")).toThrow(/mal formé/);
  });
});
