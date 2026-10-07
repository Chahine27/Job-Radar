import { describe, expect, it } from "vitest";
import { dedupeKeyOf, sameOffer } from "./dedupe";

const offer = (title: string, city: string | null = "Paris", department: string | null = "75") => ({ title, city, department });

describe("dedupeKeyOf : même offre, écritures différentes", () => {
  const key = dedupeKeyOf("Nordia", "Assistant comptable fournisseurs - CDD (H/F)");
  it("suffixe de contrat, (H/F), tirets, majuscules et raison sociale n'y changent rien", () => {
    expect(dedupeKeyOf("Nordia", "Assistant comptable fournisseurs - CDD")).toBe(key);
    expect(dedupeKeyOf("NORDIA SAS", "assistant  comptable fournisseurs – cdd (f/h)")).toBe(key);
    expect(dedupeKeyOf("Clinique du Parc", "Aide-soignant·e de nuit")).toBe(dedupeKeyOf("Clinique du Parc", "Aide-soignant de nuit H/F"));
    expect(dedupeKeyOf("Maison Lune", "Vendeur·se en boulangerie")).toBe(dedupeKeyOf("Maison Lune", "Vendeur en boulangerie"));
  });
  it("un autre intitulé ou une autre entreprise donne une autre clé", () => {
    expect(dedupeKeyOf("Nordia", "Comptable fournisseurs")).not.toBe(dedupeKeyOf("Nordia", "Comptable fournisseurs senior"));
    expect(dedupeKeyOf("Autre", "Assistant comptable fournisseurs")).not.toBe(key);
  });
  it("sans entreprise : pas de clé (on ne fusionne pas à l'aveugle)", () => {
    expect(dedupeKeyOf(null, "Comptable")).toBeNull();
  });
});

describe("sameOffer : titre, contrat, lieu", () => {
  it("Paris = 8ème Arrondissement = lieu inconnu, tant que le département ne dit pas le contraire", () => {
    expect(sameOffer(offer("Comptable - CDI", "Paris", "75"), offer("Comptable - CDI", "8ème Arrondissement", "75"))).toBe(true);
    expect(sameOffer(offer("Comptable", "Paris", "75"), offer("Comptable", null, null))).toBe(true);
    expect(sameOffer(offer("Comptable", "Paris", null), offer("Comptable", "8ème Arrondissement", null))).toBe(true);
  });
  it("villes précises différentes, même voisines : deux offres (le trajet n'est pas le même)", () => {
    expect(sameOffer(offer("Infirmier", "Angers", "49"), offer("Infirmier", "Avrillé", "49"))).toBe(false);
    expect(sameOffer(offer("Infirmier", "Lyon", "69"), offer("Infirmier", "Paris", "75"))).toBe(false);
    expect(sameOffer(offer("Infirmier", "Lyon", null), offer("Infirmier", "Paris", null))).toBe(false);
  });
  it("lieu vague (« France », arrondissement seul) : compatible sauf si les départements diffèrent", () => {
    expect(sameOffer(offer("Comptable", "La Défense", "92"), offer("Comptable", "France", null))).toBe(true);
    expect(sameOffer(offer("Comptable", "Paris 5e Arrondissement", "75"), offer("Comptable", "Paris", "75"))).toBe(true);
    expect(sameOffer(offer("Comptable", "8ème Arrondissement", "75"), offer("Comptable", "Lyon", "69"))).toBe(false);
  });
  it("CDI et CDD écrits dans les deux titres : deux offres ; contrat absent d'un titre : on ne conclut rien", () => {
    expect(sameOffer(offer("Gestionnaire de paie - CDI"), offer("Gestionnaire de paie - CDD"))).toBe(false);
    expect(sameOffer(offer("Gestionnaire de paie - CDD (H/F)"), offer("Gestionnaire de paie - CDD"))).toBe(true);
    expect(sameOffer(offer("Gestionnaire de paie confirmé (CDI)"), offer("Gestionnaire de paie confirmé"))).toBe(true);
  });
});
