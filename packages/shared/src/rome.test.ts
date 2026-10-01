import { describe, expect, it } from "vitest";
import { ROME_VERSION, isRomeCode, romeLabel, romeSearchCodes, romeWords, searchRome } from "./rome";

describe("liste officielle du ROME", () => {
  it("contient la version et des codes connus", () => {
    expect(ROME_VERSION).toContain("ROME 4.0");
    expect(isRomeCode("J1501")).toBe(true);
    expect(romeLabel("J1501")).toBe("Aide-soignant / Aide-soignante");
    expect(romeLabel("M1203")).toBe("Comptable");
  });

  it("refuse les codes inventés ou mal formés", () => {
    expect(isRomeCode("Z9999")).toBe(false);
    expect(isRomeCode("J9999")).toBe(false);
    expect(isRomeCode("j1501")).toBe(false);
    expect(romeLabel("A0000")).toBeNull();
  });

  it("La Bonne Boîte : ajoute la fiche parente, sans doublon ni code inconnu", () => {
    expect(romeSearchCodes(["J1501", "J1501", "X1234"])).toEqual(["J1501"]);
    // Accastilleur-gréeur (I1634) est rattaché à la fiche I1601.
    expect(romeSearchCodes(["I1634"])).toEqual(["I1634", "I1601"]);
  });

  it("découpe un intitulé en mots utiles", () => {
    expect(romeWords("Aide-soignante en EHPAD")).toEqual(["aide", "soignante", "ehpad"]);
  });

  it("trouve le métier dans la liste, pour des métiers variés", () => {
    expect(searchRome("Aide-soignante")[0]?.code).toBe("J1501");
    expect(searchRome("Assistant comptable")[0]?.code).toBe("M1213");
    expect(searchRome("Boulanger")[0]?.code).toBe("D1102");
    expect(searchRome("Conducteur poids lourd")[0]?.code).toBe("N4101");
    expect(searchRome("j1501")).toEqual([{ code: "J1501", label: "Aide-soignant / Aide-soignante", score: 1 }]);
  });

  it("ne renvoie que des codes de la liste, et rien pour un texte vide ou sans rapport", () => {
    for (const j of searchRome("Comptable", 8)) expect(isRomeCode(j.code)).toBe(true);
    expect(searchRome("")).toEqual([]);
    expect(searchRome("zzqxw")).toEqual([]);
  });
});
