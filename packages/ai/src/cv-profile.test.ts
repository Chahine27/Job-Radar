import { describe, expect, it } from "vitest";
import { readCvWithAi, toProposal, type CvReading } from "./cv-profile";

const CV = `Camille Martin
12 rue des Lilas 69003 Lyon — 06 12 34 56 78 — camille.martin@example.com
Assistante comptable, 3 ans d'expérience. Logiciels : Sage, Excel. Permis B.`;

const reading = (over: Partial<CvReading> = {}): CvReading => ({
  nom_complet: "Camille Martin",
  email: "camille.martin@example.com",
  telephone: "06 12 34 56 78",
  ville: "Lyon",
  code_postal: "69003",
  metier: "Assistante comptable",
  intitules_recherche: ["Assistant comptable", "Comptable", "comptable"],
  competences: ["Sage", "Excel", "SAP"],
  annees_experience: 2.6,
  contrats: ["CDI", "CDI"],
  ...over,
});

describe("profil tiré du CV", () => {
  it("garde ce qui est écrit dans le CV", () => {
    const p = toProposal(reading(), CV);
    expect(p.fullName).toBe("Camille Martin");
    expect(p.phone).toBe("06 12 34 56 78");
    expect(p.department).toBe("69");
    expect(p.yearsOfExperience).toBe(3);
    expect(p.contracts).toEqual(["CDI"]);
    // doublons retirés
    expect(p.searches).toEqual(["Assistant comptable", "Comptable"]);
  });

  it("jette ce que l'IA a inventé", () => {
    const p = toProposal(reading({ email: "autre@example.com", code_postal: "75011", ville: "Marseille", nom_complet: "Jean Dupont" }), CV);
    expect(p.email).toBeNull();
    expect(p.postalCode).toBeNull();
    expect(p.city).toBeNull();
    expect(p.fullName).toBeNull();
    expect(p.skills).toEqual(["Sage", "Excel"]); // SAP n'est pas dans le CV
  });

  it("réessaie une fois si la réponse est hors format", async () => {
    let calls = 0;
    const client = {
      model: "m",
      chatJson: async () => (++calls === 1 ? { nimporte: "quoi" } : reading()),
    };
    const res = await readCvWithAi(client as never, CV);
    expect(calls).toBe(2);
    expect(res.proposal.skills).toContain("Sage");
  });
});
